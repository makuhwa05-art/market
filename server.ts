import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import {
  admins,
  auditLogs,
  categories,
  datingPackages,
  datingProfiles,
  datingSubscriptions,
  houses,
  jobs,
  marketItems,
  notifications,
  paymentTransactions,
  platformSettings,
  reports,
  sponsorshipPayments,
  sponsorshipPlans,
  users,
} from './src/db/schema.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  hashPassword,
  signAdminToken,
  signUserToken,
  verifyAdminToken,
  verifyPassword,
  verifyUserToken,
} from './server/auth.ts';
import { registerDatingAndPaymentRoutes } from './server/datingAndPaymentsRoutes.ts';
import { getGatewayCapabilities } from './server/payments.ts';
import {
  isValidZimbabwePhone,
  normalizeZimbabwePhone,
  sanitizeImageValue,
  sanitizePhotosArray,
} from './server/phone.ts';
import {
  ALL_PERMISSIONS,
  DEFAULT_EXPIRY_DAYS,
  ensureSeeded,
  expireStaleDatingSubscriptions,
  expireStaleSponsorships,
  getPublicHouses,
  getPublicJobs,
  getPublicMarketItems,
  logAudit,
  notifyUser,
  ROLE_DEFAULT_PERMISSIONS,
  upsertUserFromFirebase,
  type AdminPermission,
} from './server/repository.ts';

type DbUser = typeof users.$inferSelect;
type DbAdmin = typeof admins.$inferSelect;

interface AuthedUserRequest extends express.Request {
  currentUser?: DbUser;
}

interface AuthedAdminRequest extends express.Request {
  currentAdmin?: DbAdmin;
}

const VALID_HOUSE_TYPES = new Set(['House', 'Room', 'Flat', 'Apartment', 'Cottage', 'Commercial']);
const VALID_EMPLOYMENT_TYPES = new Set(['Full-time', 'Part-time', 'Contract', 'Casual', 'Internship']);

function cleanText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function parsePositiveId(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toPublicUser<T extends { passwordHash?: string | null }>(userRow: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omitted, ...safeUser } = userRow;
  return safeUser;
}

async function resolveFirebaseUser(req: express.Request): Promise<DbUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  // 1. Check custom platform user Bearer token (email/phone + password accounts)
  const verifiedUser = verifyUserToken(idToken);
  if (verifiedUser) {
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, verifiedUser.userId))
      .limit(1);
    return userRow ?? null;
  }

  // 2. Fallback to Firebase Auth ID token (Continue with Google)
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = decoded.email || `${decoded.uid}@firebase.user`;
    const userRow = await upsertUserFromFirebase({
      uid: decoded.uid,
      email,
      displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
      photoUrl: typeof decoded.picture === 'string' ? decoded.picture : null,
    });
    return userRow;
  } catch {
    return null;
  }
}

async function requireUserAuth(
  req: AuthedUserRequest,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    await ensureSeeded();
    const userRow = await resolveFirebaseUser(req);
    if (!userRow) {
      res.status(401).json({ error: 'Please sign in to continue.' });
      return;
    }
    if (userRow.accountStatus === 'suspended' || userRow.verificationStatus === 'suspended') {
      res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
      return;
    }
    req.currentUser = userRow;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

function requireAdminPerm(permission?: AdminPermission | AdminPermission[]) {
  return async (req: AuthedAdminRequest, res: express.Response, next: express.NextFunction) => {
    try {
      await ensureSeeded();
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Administrator sign-in required.' });
        return;
      }
      const token = authHeader.slice(7).trim();
      const verified = verifyAdminToken(token);
      if (!verified) {
        res.status(401).json({ error: 'Invalid or expired administrator session.' });
        return;
      }

      const [adminRow] = await db
        .select()
        .from(admins)
        .where(eq(admins.id, verified.adminId))
        .limit(1);

      if (!adminRow || !adminRow.isActive) {
        res.status(403).json({ error: 'Administrator account is inactive.' });
        return;
      }

      if (permission && adminRow.role !== 'super_admin') {
        const required = Array.isArray(permission) ? permission : [permission];
        const allowed = required.some((p) => adminRow.permissions.includes(p));
        if (!allowed) {
          res.status(403).json({
            error: `Permission denied: requires "${required.join(' or ')}" privilege.`,
          });
          return;
        }
      }

      req.currentAdmin = adminRow;
      next();
    } catch (err) {
      console.error('Admin auth error:', err);
      res.status(500).json({ error: 'Administrator authorization error.' });
    }
  };
}

async function getSettingValue(key: string, fallback: string): Promise<string> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '6mb' }));

  // ============================================================================
  // Public Metadata & Feed Routes
  // ============================================================================
  app.get('/api/meta', async (_req, res) => {
    try {
      await ensureSeeded();
      const [allCats, plans, pkgRows, paymentInstructions, datingEnabled, datingAllowHiv] =
        await Promise.all([
          db
            .select()
            .from(categories)
            .where(eq(categories.isActive, true))
            .orderBy(categories.sortOrder, categories.name),
          db
            .select()
            .from(sponsorshipPlans)
            .where(eq(sponsorshipPlans.isActive, true))
            .orderBy(sponsorshipPlans.durationDays),
          db
            .select()
            .from(datingPackages)
            .where(eq(datingPackages.isActive, true))
            .orderBy(datingPackages.priceUsd),
          getSettingValue(
            'payment_instructions',
            'Pay via Paynow Zimbabwe, PayPal, EcoCash, InnBucks, or Bank Transfer.'
          ),
          getSettingValue('dating_enabled', 'true'),
          getSettingValue('dating_allow_hiv_disclosure', 'true'),
        ]);

      res.json({
        categories: {
          job: allCats.filter((c) => c.section === 'job').map((c) => c.name),
          market: allCats.filter((c) => c.section === 'market').map((c) => c.name),
          house: allCats.filter((c) => c.section === 'house').map((c) => c.name),
        },
        sponsorshipPlans: plans,
        datingPackages: pkgRows,
        datingEnabled: datingEnabled === 'true',
        datingAllowHivDisclosure: datingAllowHiv === 'true',
        paymentCapabilities: getGatewayCapabilities(),
        paymentInstructions,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load metadata.' });
    }
  });

  app.get('/api/jobs', async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
      const result = await getPublicJobs({
        q: cleanText(req.query.q, 100),
        location: cleanText(req.query.location, 60),
        category: cleanText(req.query.category, 60),
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch jobs.' });
    }
  });

  app.get('/api/market', async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
      const result = await getPublicMarketItems({
        q: cleanText(req.query.q, 100),
        location: cleanText(req.query.location, 60),
        category: cleanText(req.query.category, 60),
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch market items.' });
    }
  });

  app.get('/api/houses', async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
      const result = await getPublicHouses({
        q: cleanText(req.query.q, 100),
        location: cleanText(req.query.location, 60),
        propertyType: cleanText(req.query.propertyType, 40),
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch houses.' });
    }
  });

  // Public suspicious listing reporting
  app.post('/api/reports', async (req, res) => {
    try {
      await ensureSeeded();
      const listingType = cleanText(req.body?.listingType, 20);
      const listingId = Number(req.body?.listingId);
      const reason = cleanText(req.body?.reason, 100);
      const details = cleanText(req.body?.details, 500) || null;

      if (!['job', 'market', 'house', 'dating'].includes(listingType) || !Number.isInteger(listingId) || !reason) {
        res.status(400).json({ error: 'Please select a reason for this report.' });
        return;
      }

      let listingTitle = '';
      if (listingType === 'job') {
        const [row] = await db.select({ title: jobs.title }).from(jobs).where(eq(jobs.id, listingId)).limit(1);
        listingTitle = row?.title ?? '';
      } else if (listingType === 'market') {
        const [row] = await db
          .select({ title: marketItems.title })
          .from(marketItems)
          .where(eq(marketItems.id, listingId))
          .limit(1);
        listingTitle = row?.title ?? '';
      } else if (listingType === 'house') {
        const [row] = await db.select({ title: houses.title }).from(houses).where(eq(houses.id, listingId)).limit(1);
        listingTitle = row?.title ?? '';
      } else {
        const [row] = await db
          .select({ name: datingProfiles.displayName })
          .from(datingProfiles)
          .where(eq(datingProfiles.id, listingId))
          .limit(1);
        listingTitle = row ? `Singles: ${row.name}` : '';
      }

      if (!listingTitle) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
      }

      const reporter = await resolveFirebaseUser(req);
      const reporterName = reporter?.fullName ?? 'Guest Visitor';

      const [created] = await db
        .insert(reports)
        .values({
          listingType,
          listingId,
          listingTitle,
          reporterUserId: reporter?.id ?? null,
          reporterName,
          reason,
          details,
        })
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: reporter ? String(reporter.id) : null,
        actorName: reporterName,
        action: 'listing_reported',
        targetType: listingType,
        targetId: String(listingId),
        summary: `${reporterName} reported ${listingType} "${listingTitle}" (${reason})`,
      });

      res.status(201).json({ ok: true, id: created.id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit report.' });
    }
  });

  // ============================================================================
  // User Sign Up, Sign In & Profile Onboarding
  // ============================================================================
  app.post('/api/auth/register', async (req, res) => {
    try {
      await ensureSeeded();
      const fullName = cleanText(req.body?.fullName, 80);
      const email = cleanText(req.body?.email, 120).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const rawPhone = cleanText(req.body?.phone, 30);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || rawPhone;
      const city = cleanText(req.body?.city, 60) || 'Harare';
      const rawDatingOptIn = cleanText(req.body?.datingOptIn, 10).toLowerCase();
      const datingOptIn = ['yes', 'no', 'unset'].includes(rawDatingOptIn) ? rawDatingOptIn : 'unset';

      if (fullName.length < 2) {
        res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
        return;
      }
      if (!isValidZimbabwePhone(rawPhone) || !isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter valid Zimbabwe phone and WhatsApp numbers (e.g. 0771234567).' });
        return;
      }

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(sql`LOWER(${users.email})`, email))
        .limit(1);

      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
        return;
      }

      const phone = normalizeZimbabwePhone(rawPhone);
      const whatsapp = normalizeZimbabwePhone(rawWhatsapp);
      const passwordHash = hashPassword(password);
      const uid = `local-${crypto.randomUUID()}`;

      const [created] = await db
        .insert(users)
        .values({
          uid,
          email,
          passwordHash,
          fullName,
          phone,
          whatsapp,
          city,
          avatar: null,
          datingOptIn,
          verificationStatus: 'unverified',
          accountStatus: 'active',
        })
        .returning();

      const token = signUserToken({
        userId: created.id,
        uid: created.uid,
        email: created.email,
      });

      await logAudit({
        actorType: 'user',
        actorId: String(created.id),
        actorName: created.fullName,
        action: 'user_registered',
        targetType: 'user',
        targetId: String(created.id),
        summary: `${created.fullName} created a new account (${city})`,
      });

      res.status(201).json({
        token,
        user: toPublicUser(created),
        notifications: [],
        unreadCount: 0,
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Failed to create account.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      await ensureSeeded();
      const identifier = cleanText(req.body?.identifier ?? req.body?.email, 120);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!identifier || !password) {
        res.status(400).json({ error: 'Email or phone number and password are required.' });
        return;
      }

      let userRow: DbUser | undefined;
      if (identifier.includes('@')) {
        const [found] = await db
          .select()
          .from(users)
          .where(eq(sql`LOWER(${users.email})`, identifier.toLowerCase()))
          .limit(1);
        userRow = found;
      } else if (isValidZimbabwePhone(identifier)) {
        const normalized = normalizeZimbabwePhone(identifier);
        const [found] = await db
          .select()
          .from(users)
          .where(or(eq(users.phone, normalized), eq(users.whatsapp, normalized)))
          .limit(1);
        userRow = found;
      }

      if (!userRow || !userRow.passwordHash || !verifyPassword(password, userRow.passwordHash)) {
        res.status(401).json({
          error:
            'Invalid email, phone number, or password. If you created your account with Google, tap Continue with Google.',
        });
        return;
      }

      if (userRow.accountStatus === 'suspended' || userRow.verificationStatus === 'suspended') {
        res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
        return;
      }

      const userNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userRow.id))
        .orderBy(desc(notifications.createdAt))
        .limit(30);

      const token = signUserToken({
        userId: userRow.id,
        uid: userRow.uid,
        email: userRow.email,
      });

      res.json({
        token,
        user: toPublicUser(userRow),
        notifications: userNotifs,
        unreadCount: userNotifs.filter((n) => !n.isRead).length,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Failed to sign in.' });
    }
  });

  // ============================================================================
  // Authenticated User Profile, Listings & Sponsorship Requests
  // ============================================================================
  app.get('/api/auth/me', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const userNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(30);

      res.json({
        user: toPublicUser(user),
        notifications: userNotifs,
        unreadCount: userNotifs.filter((n) => !n.isRead).length,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  app.put('/api/auth/profile', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const fullName = cleanText(req.body?.fullName, 80);
      const rawPhone = cleanText(req.body?.phone, 30);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || rawPhone;
      const city = cleanText(req.body?.city, 60);
      const avatarInput = req.body?.avatar;
      const avatar = avatarInput === null ? null : sanitizeImageValue(avatarInput) ?? user.avatar;

      if (fullName.length < 2) {
        res.status(400).json({ error: 'Full name is required.' });
        return;
      }
      if (!isValidZimbabwePhone(rawPhone) || !isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter valid Zimbabwe phone and WhatsApp numbers (e.g. 0771234567).' });
        return;
      }
      if (!city) {
        res.status(400).json({ error: 'Please select your city or location.' });
        return;
      }

      const phone = normalizeZimbabwePhone(rawPhone);
      const whatsapp = normalizeZimbabwePhone(rawWhatsapp);
      const rawDatingOptIn = cleanText(req.body?.datingOptIn, 10).toLowerCase();
      const datingOptIn = ['yes', 'no', 'unset'].includes(rawDatingOptIn)
        ? rawDatingOptIn
        : user.datingOptIn;

      const [updated] = await db
        .update(users)
        .set({
          fullName,
          phone,
          whatsapp,
          city,
          avatar,
          datingOptIn,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      await Promise.all([
        db.update(jobs).set({ authorName: fullName }).where(eq(jobs.userId, user.id)),
        db.update(marketItems).set({ authorName: fullName }).where(eq(marketItems.userId, user.id)),
        db.update(houses).set({ authorName: fullName }).where(eq(houses.userId, user.id)),
      ]);

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: fullName,
        action: 'profile_updated',
        targetType: 'user',
        targetId: String(user.id),
        summary: `${fullName} updated their profile (${city})`,
      });

      res.json({ user: toPublicUser(updated) });
    } catch {
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  app.post('/api/auth/request-verification', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      if (user.verificationStatus === 'verified') {
        res.status(400).json({ error: 'Your account is already verified.' });
        return;
      }
      if (user.verificationStatus === 'pending') {
        res.status(400).json({ error: 'Your verification request is already under review.' });
        return;
      }
      if (!user.fullName || !isValidZimbabwePhone(user.whatsapp) || !user.city) {
        res.status(400).json({
          error: 'Please save your full name, WhatsApp number, and city in your profile before requesting verification.',
        });
        return;
      }

      const [updated] = await db
        .update(users)
        .set({ verificationStatus: 'pending', updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'verification_requested',
        targetType: 'user',
        targetId: String(user.id),
        summary: `${user.fullName} requested account verification`,
      });

      res.json({ user: toPublicUser(updated) });
    } catch {
      res.status(500).json({ error: 'Could not submit verification request.' });
    }
  });

  app.post('/api/auth/notifications/read', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, user.id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to update notifications.' });
    }
  });

  app.get('/api/my-listings', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      await expireStaleSponsorships();
      const user = req.currentUser!;
      const [myJobs, myMarket, myHouses, myPayments] = await Promise.all([
        db.select().from(jobs).where(eq(jobs.userId, user.id)).orderBy(desc(jobs.createdAt)),
        db.select().from(marketItems).where(eq(marketItems.userId, user.id)).orderBy(desc(marketItems.createdAt)),
        db.select().from(houses).where(eq(houses.userId, user.id)).orderBy(desc(houses.createdAt)),
        db
          .select()
          .from(sponsorshipPayments)
          .where(eq(sponsorshipPayments.userId, user.id))
          .orderBy(desc(sponsorshipPayments.createdAt)),
      ]);

      res.json({
        jobs: myJobs.map((j) => ({ ...j, isVerified: user.verificationStatus === 'verified' })),
        market: myMarket.map((m) => ({ ...m, isVerified: user.verificationStatus === 'verified' })),
        houses: myHouses.map((h) => ({ ...h, isVerified: user.verificationStatus === 'verified' })),
        sponsorshipPayments: myPayments,
      });
    } catch {
      res.status(500).json({ error: 'Could not load your listings.' });
    }
  });

  // Jobs CRUD (Users post into pending approval; edits reset to pending approval)
  app.post('/api/jobs', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const title = cleanText(req.body?.title, 120);
      const employer = cleanText(req.body?.employer, 100);
      const description = cleanText(req.body?.description, 2500);
      const requirements = cleanText(req.body?.requirements, 1500);
      const salary = cleanText(req.body?.salary, 80) || null;
      const employmentTypeRaw = cleanText(req.body?.employmentType, 30);
      const employmentType = VALID_EMPLOYMENT_TYPES.has(employmentTypeRaw) ? employmentTypeRaw : 'Full-time';
      const category = cleanText(req.body?.category, 60) || 'Sales & Retail';
      const location = cleanText(req.body?.location, 60);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.whatsapp;

      if (!title || !employer || !description || !requirements || !location) {
        res.status(400).json({ error: 'Please complete title, employer, description, requirements, and location.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const expiryDays = Number(await getSettingValue('listing_expiry_days', String(DEFAULT_EXPIRY_DAYS))) || 30;
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * expiryDays);

      const [created] = await db
        .insert(jobs)
        .values({
          userId: user.id,
          authorUid: user.uid,
          authorName: user.fullName,
          title,
          employer,
          description,
          requirements,
          salary,
          employmentType,
          category,
          location,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          lifecycleStatus: 'active',
          isSponsored: false,
          expiresAt,
        })
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'job_submitted',
        targetType: 'job',
        targetId: String(created.id),
        summary: `${user.fullName} submitted job "${title}" for approval`,
      });

      res.status(201).json({ item: created });
    } catch {
      res.status(500).json({ error: 'Failed to submit job listing.' });
    }
  });

  app.put('/api/jobs/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid job ID.' });
        return;
      }
      const [existing] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Job listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only edit your own job posts.' });
        return;
      }

      const title = cleanText(req.body?.title, 120);
      const employer = cleanText(req.body?.employer, 100);
      const description = cleanText(req.body?.description, 2500);
      const requirements = cleanText(req.body?.requirements, 1500);
      const salary = cleanText(req.body?.salary, 80) || null;
      const employmentTypeRaw = cleanText(req.body?.employmentType, 30);
      const employmentType = VALID_EMPLOYMENT_TYPES.has(employmentTypeRaw)
        ? employmentTypeRaw
        : existing.employmentType;
      const category = cleanText(req.body?.category, 60) || existing.category;
      const location = cleanText(req.body?.location, 60);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30);

      if (!title || !employer || !description || !requirements || !location) {
        res.status(400).json({ error: 'All required job fields must be completed.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const [updated] = await db
        .update(jobs)
        .set({
          title,
          employer,
          description,
          requirements,
          salary,
          employmentType,
          category,
          location,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          moderationReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, id), eq(jobs.userId, user.id)))
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'job_edited',
        targetType: 'job',
        targetId: String(id),
        summary: `${user.fullName} edited job "${title}" (returned to pending approval)`,
      });

      res.json({ item: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update job listing.' });
    }
  });

  app.delete('/api/jobs/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid job ID.' });
        return;
      }
      const [existing] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Job listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only delete your own job posts.' });
        return;
      }
      await db.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, user.id)));
      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'job_deleted',
        targetType: 'job',
        targetId: String(id),
        summary: `${user.fullName} deleted job "${existing.title}"`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete job listing.' });
    }
  });

  // Market CRUD
  app.post('/api/market', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const title = cleanText(req.body?.title, 120);
      const price = Number(req.body?.price);
      const currency = req.body?.currency === 'ZiG' ? 'ZiG' : 'USD';
      const description = cleanText(req.body?.description, 2500);
      const category = cleanText(req.body?.category, 60) || 'Other';
      const location = cleanText(req.body?.location, 60);
      const photos = sanitizePhotosArray(req.body?.photos, 4);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.whatsapp;

      if (!title || !description || !location || !Number.isFinite(price) || price < 0) {
        res.status(400).json({ error: 'Please enter item name, valid price, description, and location.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const expiryDays = Number(await getSettingValue('listing_expiry_days', String(DEFAULT_EXPIRY_DAYS))) || 30;
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * expiryDays);

      const [created] = await db
        .insert(marketItems)
        .values({
          userId: user.id,
          authorUid: user.uid,
          authorName: user.fullName,
          title,
          price,
          currency,
          description,
          category,
          location,
          photos,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          lifecycleStatus: 'active',
          isSponsored: false,
          expiresAt,
        })
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'market_submitted',
        targetType: 'market',
        targetId: String(created.id),
        summary: `${user.fullName} submitted market listing "${title}" for approval`,
      });

      res.status(201).json({ item: created });
    } catch {
      res.status(500).json({ error: 'Failed to submit market listing.' });
    }
  });

  app.put('/api/market/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid market listing ID.' });
        return;
      }
      const [existing] = await db.select().from(marketItems).where(eq(marketItems.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Market listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only edit your own market listings.' });
        return;
      }

      const title = cleanText(req.body?.title, 120);
      const price = Number(req.body?.price);
      const currency = req.body?.currency === 'ZiG' ? 'ZiG' : 'USD';
      const description = cleanText(req.body?.description, 2500);
      const category = cleanText(req.body?.category, 60) || existing.category;
      const location = cleanText(req.body?.location, 60);
      const photos = sanitizePhotosArray(req.body?.photos, 4);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30);

      if (!title || !description || !location || !Number.isFinite(price) || price < 0) {
        res.status(400).json({ error: 'Complete all required listing fields.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const [updated] = await db
        .update(marketItems)
        .set({
          title,
          price,
          currency,
          description,
          category,
          location,
          photos,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          moderationReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(marketItems.id, id), eq(marketItems.userId, user.id)))
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'market_edited',
        targetType: 'market',
        targetId: String(id),
        summary: `${user.fullName} edited market listing "${title}" (returned to pending approval)`,
      });

      res.json({ item: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update market listing.' });
    }
  });

  app.delete('/api/market/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid market listing ID.' });
        return;
      }
      const [existing] = await db.select().from(marketItems).where(eq(marketItems.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Market listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only delete your own market listings.' });
        return;
      }
      await db.delete(marketItems).where(and(eq(marketItems.id, id), eq(marketItems.userId, user.id)));
      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'market_deleted',
        targetType: 'market',
        targetId: String(id),
        summary: `${user.fullName} deleted market listing "${existing.title}"`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete market listing.' });
    }
  });

  // Houses CRUD
  app.post('/api/houses', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const propertyType = cleanText(req.body?.propertyType, 30);
      const title = cleanText(req.body?.title, 120);
      const suburb = cleanText(req.body?.suburb, 80);
      const city = cleanText(req.body?.city, 60);
      const price = Number(req.body?.price);
      const bedroomsRaw = Number(req.body?.bedrooms);
      const bedrooms = Number.isFinite(bedroomsRaw) ? Math.max(0, Math.min(20, Math.round(bedroomsRaw))) : 1;
      const description = cleanText(req.body?.description, 2500);
      const facilities = Array.isArray(req.body?.facilities)
        ? req.body.facilities
            .filter((f: unknown): f is string => typeof f === 'string')
            .map((f: string) => f.trim().slice(0, 50))
            .filter(Boolean)
            .slice(0, 12)
        : [];
      const photos = sanitizePhotosArray(req.body?.photos, 4);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.whatsapp;

      if (!VALID_HOUSE_TYPES.has(propertyType)) {
        res.status(400).json({ error: 'Please select a valid property type.' });
        return;
      }
      if (!title || !suburb || !city || !description || !Number.isFinite(price) || price <= 0) {
        res.status(400).json({ error: 'Please complete title, suburb, city, monthly rent, and description.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const expiryDays = Number(await getSettingValue('listing_expiry_days', String(DEFAULT_EXPIRY_DAYS))) || 30;
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * expiryDays);

      const [created] = await db
        .insert(houses)
        .values({
          userId: user.id,
          authorUid: user.uid,
          authorName: user.fullName,
          propertyType,
          title,
          suburb,
          city,
          price,
          bedrooms,
          description,
          facilities,
          photos,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          lifecycleStatus: 'active',
          isSponsored: false,
          expiresAt,
        })
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'house_submitted',
        targetType: 'house',
        targetId: String(created.id),
        summary: `${user.fullName} submitted property "${title}" (${suburb}, ${city}) for approval`,
      });

      res.status(201).json({ item: created });
    } catch {
      res.status(500).json({ error: 'Failed to submit property listing.' });
    }
  });

  app.put('/api/houses/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid property ID.' });
        return;
      }
      const [existing] = await db.select().from(houses).where(eq(houses.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Property listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only edit your own property listings.' });
        return;
      }

      const propertyType = cleanText(req.body?.propertyType, 30);
      const title = cleanText(req.body?.title, 120);
      const suburb = cleanText(req.body?.suburb, 80);
      const city = cleanText(req.body?.city, 60);
      const price = Number(req.body?.price);
      const bedroomsRaw = Number(req.body?.bedrooms);
      const bedrooms = Number.isFinite(bedroomsRaw)
        ? Math.max(0, Math.min(20, Math.round(bedroomsRaw)))
        : existing.bedrooms;
      const description = cleanText(req.body?.description, 2500);
      const facilities = Array.isArray(req.body?.facilities)
        ? req.body.facilities
            .filter((f: unknown): f is string => typeof f === 'string')
            .map((f: string) => f.trim().slice(0, 50))
            .filter(Boolean)
            .slice(0, 12)
        : [];
      const photos = sanitizePhotosArray(req.body?.photos, 4);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30);

      if (!VALID_HOUSE_TYPES.has(propertyType)) {
        res.status(400).json({ error: 'Please select a valid property type.' });
        return;
      }
      if (!title || !suburb || !city || !description || !Number.isFinite(price) || price <= 0) {
        res.status(400).json({ error: 'Complete all required property fields.' });
        return;
      }
      if (!isValidZimbabwePhone(rawWhatsapp)) {
        res.status(400).json({ error: 'Enter a valid Zimbabwe WhatsApp number.' });
        return;
      }

      const [updated] = await db
        .update(houses)
        .set({
          propertyType,
          title,
          suburb,
          city,
          price,
          bedrooms,
          description,
          facilities,
          photos,
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          approvalStatus: 'pending',
          moderationReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(houses.id, id), eq(houses.userId, user.id)))
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'house_edited',
        targetType: 'house',
        targetId: String(id),
        summary: `${user.fullName} edited property "${title}" (returned to pending approval)`,
      });

      res.json({ item: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update property listing.' });
    }
  });

  app.delete('/api/houses/:id', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid property ID.' });
        return;
      }
      const [existing] = await db.select().from(houses).where(eq(houses.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'Property listing not found.' });
        return;
      }
      if (existing.userId !== user.id) {
        res.status(403).json({ error: 'You can only delete your own property listings.' });
        return;
      }
      await db.delete(houses).where(and(eq(houses.id, id), eq(houses.userId, user.id)));
      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'house_deleted',
        targetType: 'house',
        targetId: String(id),
        summary: `${user.fullName} deleted property "${existing.title}"`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete property listing.' });
    }
  });

  // Owner marks their own listing sold / filled / rented or active
  app.patch('/api/my-listings/:type/:id/lifecycle', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const type = String(req.params.type);
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid listing ID.' });
        return;
      }
      const lifecycleStatus = cleanText(req.body?.lifecycleStatus, 20);

      if (type === 'job' && ['active', 'filled'].includes(lifecycleStatus)) {
        const [updated] = await db
          .update(jobs)
          .set({ lifecycleStatus, updatedAt: new Date() })
          .where(and(eq(jobs.id, id), eq(jobs.userId, user.id)))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'Job listing not found.' });
          return;
        }
        res.json({ item: updated });
        return;
      }
      if (type === 'market' && ['active', 'sold'].includes(lifecycleStatus)) {
        const [updated] = await db
          .update(marketItems)
          .set({ lifecycleStatus, updatedAt: new Date() })
          .where(and(eq(marketItems.id, id), eq(marketItems.userId, user.id)))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'Market listing not found.' });
          return;
        }
        res.json({ item: updated });
        return;
      }
      if (type === 'house' && ['active', 'rented'].includes(lifecycleStatus)) {
        const [updated] = await db
          .update(houses)
          .set({ lifecycleStatus, updatedAt: new Date() })
          .where(and(eq(houses.id, id), eq(houses.userId, user.id)))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'Property listing not found.' });
          return;
        }
        res.json({ item: updated });
        return;
      }

      res.status(400).json({ error: 'Invalid listing type or lifecycle status.' });
    } catch {
      res.status(500).json({ error: 'Failed to update listing status.' });
    }
  });

  // Sponsorship Request (User submits payment reference; admin must confirm!)
  app.post('/api/sponsorships/request', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const listingType = cleanText(req.body?.listingType, 20);
      const listingId = Number(req.body?.listingId);
      const planId = Number(req.body?.planId);
      const paymentMethod = cleanText(req.body?.paymentMethod, 40);
      const paymentReference = cleanText(req.body?.paymentReference, 120);

      if (!['job', 'market', 'house'].includes(listingType) || !Number.isInteger(listingId)) {
        res.status(400).json({ error: 'Invalid listing selection.' });
        return;
      }
      if (!paymentMethod || paymentReference.length < 3) {
        res.status(400).json({ error: 'Enter your payment method and transaction reference.' });
        return;
      }

      const [plan] = await db
        .select()
        .from(sponsorshipPlans)
        .where(and(eq(sponsorshipPlans.id, planId), eq(sponsorshipPlans.isActive, true)))
        .limit(1);

      if (!plan) {
        res.status(404).json({ error: 'Selected sponsorship plan is unavailable.' });
        return;
      }

      let listingTitle = '';
      if (listingType === 'job') {
        const [row] = await db
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, listingId), eq(jobs.userId, user.id)))
          .limit(1);
        listingTitle = row?.title ?? '';
      } else if (listingType === 'market') {
        const [row] = await db
          .select()
          .from(marketItems)
          .where(and(eq(marketItems.id, listingId), eq(marketItems.userId, user.id)))
          .limit(1);
        listingTitle = row?.title ?? '';
      } else {
        const [row] = await db
          .select()
          .from(houses)
          .where(and(eq(houses.id, listingId), eq(houses.userId, user.id)))
          .limit(1);
        listingTitle = row?.title ?? '';
      }

      if (!listingTitle) {
        res.status(404).json({ error: 'Listing not found in your account.' });
        return;
      }

      const [created] = await db
        .insert(sponsorshipPayments)
        .values({
          userId: user.id,
          listingType,
          listingId,
          listingTitle,
          planId: plan.id,
          durationDays: plan.durationDays,
          amountUsd: plan.priceUsd,
          paymentMethod,
          paymentReference,
          status: 'pending',
        })
        .returning();

      await db.insert(paymentTransactions).values({
        userId: user.id,
        featureType:
          listingType === 'job'
            ? 'sponsored_job'
            : listingType === 'market'
              ? 'sponsored_market'
              : 'sponsored_house',
        targetId: listingId,
        targetTitle: listingTitle,
        planOrPackageId: plan.id,
        gateway: 'manual',
        amountUsd: plan.priceUsd,
        currency: 'USD',
        status: 'pending',
        merchantReference: `MJ-SP-${created.id}-${Date.now()}`,
        gatewayReference: paymentReference,
        metadataJson: {
          manualMethod: paymentMethod,
          planId: plan.id,
          durationDays: plan.durationDays,
          legacySponsorshipPaymentId: created.id,
        },
      });

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'sponsorship_requested',
        targetType: listingType,
        targetId: String(listingId),
        summary: `${user.fullName} requested ${plan.name} ($${plan.priceUsd}) for "${listingTitle}" (Ref: ${paymentReference})`,
      });

      res.status(201).json({ payment: created });
    } catch {
      res.status(500).json({ error: 'Could not submit sponsorship payment request.' });
    }
  });

  // AI-assisted property description generator
  app.post('/api/houses/generate-description', requireUserAuth, async (req: AuthedUserRequest, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'AI description generation is unavailable because GEMINI_API_KEY is not configured in Settings > Secrets.',
      });
      return;
    }

    const propertyType = cleanText(req.body?.propertyType, 30) || 'Property';
    const title = cleanText(req.body?.title, 120);
    const suburb = cleanText(req.body?.suburb, 80);
    const city = cleanText(req.body?.city, 60);
    const price = cleanText(String(req.body?.price ?? ''), 20);
    const bedrooms = cleanText(String(req.body?.bedrooms ?? ''), 10);
    const facilities = Array.isArray(req.body?.facilities)
      ? req.body.facilities.filter((x: unknown): x is string => typeof x === 'string').slice(0, 12)
      : [];
    const extraNotes = cleanText(req.body?.notes, 300);

    if (!suburb && !title) {
      res.status(400).json({ error: 'Please enter at least a property title or suburb before generating.' });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = [
        `Property type: ${propertyType}`,
        title ? `Title: ${title}` : '',
        suburb || city ? `Location: ${[suburb, city].filter(Boolean).join(', ')}, Zimbabwe` : '',
        price ? `Monthly rent: USD ${price}/month` : '',
        propertyType !== 'Commercial' && bedrooms ? `Bedrooms: ${bedrooms}` : '',
        facilities.length > 0 ? `Facilities: ${facilities.join(', ')}` : '',
        extraNotes ? `Landlord notes: ${extraNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Write a clear, inviting rental listing description (70 to 110 words) for a Zimbabwean tenant based ONLY on these property details. Do not invent features not mentioned. Keep the tone natural, trustworthy, and practical. Use plain text (no markdown headings or asterisks).\n\n${prompt}`,
        config: {
          systemInstruction:
            'You are a practical Zimbabwean property rental copywriter. Write concise, warm, accurate property descriptions for Harare, Bulawayo, Mutare, and other Zimbabwean cities without exaggerations or unverified claims.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const description = (response.text ?? '').trim();
      if (!description) {
        res.status(502).json({ error: 'The AI service returned an empty description.' });
        return;
      }

      res.json({ description });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate description.';
      res.status(502).json({ error: `AI generation failed: ${message}` });
    }
  });

  // ============================================================================
  // Administrator Auth & Role-Based Management Routes
  // ============================================================================
  app.get('/api/admin/status', async (_req, res) => {
    try {
      await ensureSeeded();
      const existingSuper = await db
        .select({ id: admins.id })
        .from(admins)
        .where(eq(admins.role, 'super_admin'))
        .limit(1);
      res.json({
        configured: existingSuper.length > 0,
        viaEnv: Boolean((process.env.ADMIN_PASSCODE ?? '').trim()),
      });
    } catch {
      res.status(500).json({ error: 'Failed to check administrator status.' });
    }
  });

  app.post('/api/admin/bootstrap', async (req, res) => {
    try {
      await ensureSeeded();
      const username = cleanText(req.body?.username, 40).toLowerCase() || 'superadmin';
      const fullName = cleanText(req.body?.fullName, 80) || 'Super Administrator';
      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

      if (username.length < 3 || !/^[a-z0-9_.-]+$/.test(username)) {
        res.status(400).json({ error: 'Username must be 3+ letters/numbers.' });
        return;
      }
      if (passcode.length < 8) {
        res.status(400).json({ error: 'Super Admin password must be at least 8 characters.' });
        return;
      }

      const created = await db.transaction(async (tx) => {
        const existingSuper = await tx
          .select({ id: admins.id })
          .from(admins)
          .where(eq(admins.role, 'super_admin'))
          .limit(1);
        if (existingSuper.length > 0) {
          return null;
        }
        const [inserted] = await tx
          .insert(admins)
          .values({
            username,
            fullName,
            passwordHash: hashPassword(passcode),
            role: 'super_admin',
            permissions: [...ALL_PERMISSIONS],
            isActive: true,
          })
          .returning();
        return inserted;
      });

      if (!created) {
        res.status(403).json({ error: 'Super Admin has already been configured.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(created.id),
        actorName: created.fullName,
        action: 'super_admin_claimed',
        summary: `Initial Super Admin "${created.username}" configured`,
      });

      const token = signAdminToken({
        adminId: created.id,
        username: created.username,
        role: created.role,
      });

      res.status(201).json({
        token,
        admin: {
          id: created.id,
          username: created.username,
          fullName: created.fullName,
          role: created.role,
          permissions: created.permissions,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to claim Super Admin account.' });
    }
  });

  app.post('/api/admin/login', async (req, res) => {
    try {
      await ensureSeeded();
      const username = cleanText(req.body?.username, 60).toLowerCase();
      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

      if (!username || !passcode) {
        res.status(400).json({ error: 'Enter your administrator username and password.' });
        return;
      }

      const [adminRow] = await db
        .select()
        .from(admins)
        .where(eq(admins.username, username))
        .limit(1);

      if (!adminRow || !verifyPassword(passcode, adminRow.passwordHash)) {
        res.status(401).json({ error: 'Invalid administrator credentials.' });
        return;
      }

      if (!adminRow.isActive) {
        res.status(403).json({ error: 'This administrator account has been deactivated.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(adminRow.id),
        actorName: adminRow.fullName,
        action: 'admin_login',
        summary: `${adminRow.fullName} (${adminRow.role}) signed into Admin Console`,
      });

      const token = signAdminToken({
        adminId: adminRow.id,
        username: adminRow.username,
        role: adminRow.role,
      });

      res.json({
        token,
        admin: {
          id: adminRow.id,
          username: adminRow.username,
          fullName: adminRow.fullName,
          role: adminRow.role,
          permissions: adminRow.permissions,
        },
      });
    } catch {
      res.status(500).json({ error: 'Administrator login failed.' });
    }
  });

  app.get('/api/admin/overview', requireAdminPerm(), async (_req, res) => {
    try {
      await expireStaleSponsorships();
      await expireStaleDatingSubscriptions();
      const [
        totalUsers,
        verifiedUsers,
        pendingVerificationUsers,
        suspendedUsers,
        totalJobs,
        pendingJobs,
        approvedJobs,
        rejectedJobs,
        totalMarket,
        pendingMarket,
        approvedMarket,
        rejectedMarket,
        totalHouses,
        pendingHouses,
        approvedHouses,
        rejectedHouses,
        sponsoredJobs,
        sponsoredMarket,
        sponsoredHouses,
        pendingPayments,
        confirmedPayments,
        expiredSponsorships,
        openReports,
        revenueRow,
        datingMembersRow,
        pendingDatingRow,
        activeDatingSubsRow,
        centralRevenueRow,
        recentLogs,
      ] = await Promise.all([
        db.select({ c: count() }).from(users),
        db.select({ c: count() }).from(users).where(eq(users.verificationStatus, 'verified')),
        db.select({ c: count() }).from(users).where(eq(users.verificationStatus, 'pending')),
        db.select({ c: count() }).from(users).where(eq(users.accountStatus, 'suspended')),
        db.select({ c: count() }).from(jobs),
        db.select({ c: count() }).from(jobs).where(eq(jobs.approvalStatus, 'pending')),
        db.select({ c: count() }).from(jobs).where(eq(jobs.approvalStatus, 'approved')),
        db.select({ c: count() }).from(jobs).where(eq(jobs.approvalStatus, 'rejected')),
        db.select({ c: count() }).from(marketItems),
        db.select({ c: count() }).from(marketItems).where(eq(marketItems.approvalStatus, 'pending')),
        db.select({ c: count() }).from(marketItems).where(eq(marketItems.approvalStatus, 'approved')),
        db.select({ c: count() }).from(marketItems).where(eq(marketItems.approvalStatus, 'rejected')),
        db.select({ c: count() }).from(houses),
        db.select({ c: count() }).from(houses).where(eq(houses.approvalStatus, 'pending')),
        db.select({ c: count() }).from(houses).where(eq(houses.approvalStatus, 'approved')),
        db.select({ c: count() }).from(houses).where(eq(houses.approvalStatus, 'rejected')),
        db.select({ c: count() }).from(jobs).where(eq(jobs.isSponsored, true)),
        db.select({ c: count() }).from(marketItems).where(eq(marketItems.isSponsored, true)),
        db.select({ c: count() }).from(houses).where(eq(houses.isSponsored, true)),
        db.select({ c: count() }).from(sponsorshipPayments).where(eq(sponsorshipPayments.status, 'pending')),
        db.select({ c: count() }).from(sponsorshipPayments).where(eq(sponsorshipPayments.status, 'confirmed')),
        db.select({ c: count() }).from(sponsorshipPayments).where(eq(sponsorshipPayments.status, 'expired')),
        db.select({ c: count() }).from(reports).where(eq(reports.status, 'open')),
        db
          .select({ total: sql<number>`COALESCE(SUM(${sponsorshipPayments.amountUsd}), 0)` })
          .from(sponsorshipPayments)
          .where(or(eq(sponsorshipPayments.status, 'confirmed'), eq(sponsorshipPayments.status, 'expired'))),
        db.select({ c: count() }).from(datingProfiles),
        db.select({ c: count() }).from(datingProfiles).where(eq(datingProfiles.approvalStatus, 'pending')),
        db.select({ c: count() }).from(datingSubscriptions).where(eq(datingSubscriptions.status, 'active')),
        db
          .select({ total: sql<number>`COALESCE(SUM(${paymentTransactions.amountUsd}), 0)` })
          .from(paymentTransactions)
          .where(eq(paymentTransactions.status, 'paid')),
        db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(12),
      ]);

      res.json({
        stats: {
          totalUsers: Number(totalUsers[0]?.c ?? 0),
          verifiedUsers: Number(verifiedUsers[0]?.c ?? 0),
          pendingVerificationUsers: Number(pendingVerificationUsers[0]?.c ?? 0),
          suspendedUsers: Number(suspendedUsers[0]?.c ?? 0),
          totalJobs: Number(totalJobs[0]?.c ?? 0),
          totalMarket: Number(totalMarket[0]?.c ?? 0),
          totalHouses: Number(totalHouses[0]?.c ?? 0),
          pendingListings:
            Number(pendingJobs[0]?.c ?? 0) +
            Number(pendingMarket[0]?.c ?? 0) +
            Number(pendingHouses[0]?.c ?? 0),
          approvedListings:
            Number(approvedJobs[0]?.c ?? 0) +
            Number(approvedMarket[0]?.c ?? 0) +
            Number(approvedHouses[0]?.c ?? 0),
          rejectedListings:
            Number(rejectedJobs[0]?.c ?? 0) +
            Number(rejectedMarket[0]?.c ?? 0) +
            Number(rejectedHouses[0]?.c ?? 0),
          activeSponsorships:
            Number(sponsoredJobs[0]?.c ?? 0) +
            Number(sponsoredMarket[0]?.c ?? 0) +
            Number(sponsoredHouses[0]?.c ?? 0),
          pendingPayments: Number(pendingPayments[0]?.c ?? 0),
          confirmedPayments: Number(confirmedPayments[0]?.c ?? 0),
          expiredSponsorships: Number(expiredSponsorships[0]?.c ?? 0),
          sponsorshipRevenueUsd: Number(revenueRow[0]?.total ?? 0),
          datingMembers: Number(datingMembersRow[0]?.c ?? 0),
          pendingDatingProfiles: Number(pendingDatingRow[0]?.c ?? 0),
          activeDatingSubscriptions: Number(activeDatingSubsRow[0]?.c ?? 0),
          centralRevenueUsd: Number(centralRevenueRow[0]?.total ?? 0),
          openReports: Number(openReports[0]?.c ?? 0),
        },
        recentLogs,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load dashboard overview.' });
    }
  });

  // Admin Users & Verification
  app.get('/api/admin/users', requireAdminPerm(['manage_users', 'verify_users']), async (req, res) => {
    try {
      const q = cleanText(req.query.q, 100);
      const verification = cleanText(req.query.verification, 30);

      const conditions = [];
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            ilike(users.fullName, pattern),
            ilike(users.phone, pattern),
            ilike(users.whatsapp, pattern),
            ilike(users.city, pattern),
            ilike(users.email, pattern)
          )!
        );
      }
      if (verification && verification !== 'all') {
        conditions.push(eq(users.verificationStatus, verification));
      }

      const rows = await db
        .select()
        .from(users)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(users.createdAt))
        .limit(300);

      res.json({ users: rows.map(toPublicUser) });
    } catch {
      res.status(500).json({ error: 'Failed to load users.' });
    }
  });

  app.get('/api/admin/users/:id', requireAdminPerm('manage_users'), async (req, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const [userRow] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!userRow) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      const [userJobs, userMarket, userHouses] = await Promise.all([
        db.select().from(jobs).where(eq(jobs.userId, id)).orderBy(desc(jobs.createdAt)),
        db.select().from(marketItems).where(eq(marketItems.userId, id)).orderBy(desc(marketItems.createdAt)),
        db.select().from(houses).where(eq(houses.userId, id)).orderBy(desc(houses.createdAt)),
      ]);
      res.json({
        user: toPublicUser(userRow),
        jobs: userJobs,
        market: userMarket,
        houses: userHouses,
      });
    } catch {
      res.status(500).json({ error: 'Failed to inspect user.' });
    }
  });

  app.post('/api/admin/users', requireAdminPerm('manage_users'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const fullName = cleanText(req.body?.fullName, 80);
      const email = cleanText(req.body?.email, 120) || `manual-${Date.now()}@marketjobs.co.zw`;
      const rawPhone = cleanText(req.body?.phone, 30);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || rawPhone;
      const city = cleanText(req.body?.city, 60) || 'Harare';

      if (fullName.length < 2 || !isValidZimbabwePhone(rawPhone)) {
        res.status(400).json({ error: 'Full name and valid Zimbabwe phone number are required.' });
        return;
      }

      const [created] = await db
        .insert(users)
        .values({
          uid: `admin-created-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email,
          fullName,
          phone: normalizeZimbabwePhone(rawPhone),
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          city,
          verificationStatus: 'unverified',
          accountStatus: 'active',
        })
        .returning();

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'admin_created_user',
        targetType: 'user',
        targetId: String(created.id),
        summary: `${admin.fullName} created user profile for ${fullName}`,
      });

      res.status(201).json({ user: toPublicUser(created) });
    } catch {
      res.status(500).json({ error: 'Failed to create user.' });
    }
  });

  app.put('/api/admin/users/:id', requireAdminPerm('manage_users'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const fullName = cleanText(req.body?.fullName, 80);
      const rawPhone = cleanText(req.body?.phone, 30);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || rawPhone;
      const city = cleanText(req.body?.city, 60);

      if (fullName.length < 2 || !city || !isValidZimbabwePhone(rawPhone)) {
        res.status(400).json({ error: 'Valid name, phone, and city are required.' });
        return;
      }

      const [updated] = await db
        .update(users)
        .set({
          fullName,
          phone: normalizeZimbabwePhone(rawPhone),
          whatsapp: normalizeZimbabwePhone(rawWhatsapp),
          city,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'admin_edited_user',
        targetType: 'user',
        targetId: String(id),
        summary: `${admin.fullName} edited user ${fullName}`,
      });

      res.json({ user: toPublicUser(updated) });
    } catch {
      res.status(500).json({ error: 'Failed to update user.' });
    }
  });

  app.patch('/api/admin/users/:id/status', requireAdminPerm('manage_users'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const accountStatus = req.body?.accountStatus === 'suspended' ? 'suspended' : 'active';

      const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const nextVerificationStatus =
        accountStatus === 'suspended'
          ? 'suspended'
          : existing.verificationStatus === 'suspended'
            ? 'unverified'
            : existing.verificationStatus;

      const [updated] = await db
        .update(users)
        .set({
          accountStatus,
          verificationStatus: nextVerificationStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      await notifyUser({
        userId: id,
        title: accountStatus === 'suspended' ? 'Account Suspended' : 'Account Reactivated',
        message:
          accountStatus === 'suspended'
            ? 'Your account has been suspended by an administrator.'
            : 'Your account has been reactivated. You can now post and manage listings.',
        category: 'account',
      });

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: accountStatus === 'suspended' ? 'user_suspended' : 'user_reactivated',
        targetType: 'user',
        targetId: String(id),
        summary: `${admin.fullName} ${accountStatus === 'suspended' ? 'suspended' : 'reactivated'} ${updated.fullName}`,
      });

      res.json({ user: toPublicUser(updated) });
    } catch {
      res.status(500).json({ error: 'Failed to change account status.' });
    }
  });

  app.patch('/api/admin/users/:id/verification', requireAdminPerm('verify_users'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const verificationStatus = cleanText(req.body?.verificationStatus, 30);
      const verificationNote = cleanText(req.body?.note, 300) || null;

      if (!['unverified', 'pending', 'verified', 'suspended'].includes(verificationStatus)) {
        res.status(400).json({ error: 'Invalid verification status.' });
        return;
      }

      const [updated] = await db
        .update(users)
        .set({
          verificationStatus,
          verificationNote,
          accountStatus: verificationStatus === 'suspended' ? 'suspended' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      await notifyUser({
        userId: id,
        title:
          verificationStatus === 'verified'
            ? 'Account Verified'
            : verificationStatus === 'unverified'
              ? 'Verification Revoked'
              : 'Verification Status Updated',
        message:
          verificationStatus === 'verified'
            ? 'Your profile has been manually verified. A verified badge now appears on your listings.'
            : verificationNote || `Your verification status is now: ${verificationStatus}.`,
        category: 'verification',
      });

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'user_verification_changed',
        targetType: 'user',
        targetId: String(id),
        summary: `${admin.fullName} set verification for ${updated.fullName} to "${verificationStatus}"`,
      });

      res.json({ user: toPublicUser(updated) });
    } catch {
      res.status(500).json({ error: 'Failed to update verification status.' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdminPerm('manage_users'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      await db.delete(users).where(eq(users.id, id));
      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'user_deleted',
        targetType: 'user',
        targetId: String(id),
        summary: `${admin.fullName} deleted user ${existing.fullName} (${existing.email})`,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete user.' });
    }
  });

  // Admin Listings & Moderation
  app.get('/api/admin/listings', requireAdminPerm('moderate_ads'), async (req, res) => {
    try {
      await expireStaleSponsorships();
      const typeFilter = cleanText(req.query.type, 20) || 'all';
      const approvalFilter = cleanText(req.query.approval, 30) || 'all';
      const q = cleanText(req.query.q, 100).toLowerCase();

      type UnifiedAdminListing = {
        type: 'job' | 'market' | 'house';
        id: number;
        userId: number | null;
        authorName: string;
        title: string;
        subtitle: string;
        location: string;
        priceLabel: string;
        whatsapp: string;
        approvalStatus: string;
        moderationReason: string | null;
        lifecycleStatus: string;
        isSponsored: boolean;
        sponsoredUntil: Date | null;
        expiresAt: Date | null;
        createdAt: Date;
        raw: Record<string, unknown>;
      };

      const items: UnifiedAdminListing[] = [];

      if (typeFilter === 'all' || typeFilter === 'jobs') {
        const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(250);
        for (const r of rows) {
          items.push({
            type: 'job',
            id: r.id,
            userId: r.userId,
            authorName: r.authorName,
            title: r.title,
            subtitle: `${r.employer} · ${r.employmentType} · ${r.category}`,
            location: r.location,
            priceLabel: r.salary || 'Negotiable',
            whatsapp: r.whatsapp,
            approvalStatus: r.approvalStatus,
            moderationReason: r.moderationReason,
            lifecycleStatus: r.lifecycleStatus,
            isSponsored: r.isSponsored,
            sponsoredUntil: r.sponsoredUntil,
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            raw: r,
          });
        }
      }

      if (typeFilter === 'all' || typeFilter === 'market') {
        const rows = await db.select().from(marketItems).orderBy(desc(marketItems.createdAt)).limit(250);
        for (const r of rows) {
          items.push({
            type: 'market',
            id: r.id,
            userId: r.userId,
            authorName: r.authorName,
            title: r.title,
            subtitle: r.category,
            location: r.location,
            priceLabel: r.currency === 'USD' ? `$${r.price}` : `ZiG ${r.price}`,
            whatsapp: r.whatsapp,
            approvalStatus: r.approvalStatus,
            moderationReason: r.moderationReason,
            lifecycleStatus: r.lifecycleStatus,
            isSponsored: r.isSponsored,
            sponsoredUntil: r.sponsoredUntil,
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            raw: r,
          });
        }
      }

      if (typeFilter === 'all' || typeFilter === 'houses') {
        const rows = await db.select().from(houses).orderBy(desc(houses.createdAt)).limit(250);
        for (const r of rows) {
          items.push({
            type: 'house',
            id: r.id,
            userId: r.userId,
            authorName: r.authorName,
            title: r.title,
            subtitle: `${r.propertyType} · ${r.bedrooms} Beds`,
            location: `${r.suburb}, ${r.city}`,
            priceLabel: `$${r.price}/mo`,
            whatsapp: r.whatsapp,
            approvalStatus: r.approvalStatus,
            moderationReason: r.moderationReason,
            lifecycleStatus: r.lifecycleStatus,
            isSponsored: r.isSponsored,
            sponsoredUntil: r.sponsoredUntil,
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            raw: r,
          });
        }
      }

      const filtered = items
        .filter((it) => {
          if (approvalFilter !== 'all' && it.approvalStatus !== approvalFilter) return false;
          if (q) {
            return `${it.title} ${it.subtitle} ${it.location} ${it.authorName}`.toLowerCase().includes(q);
          }
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      res.json({ items: filtered });
    } catch {
      res.status(500).json({ error: 'Failed to load advertisements.' });
    }
  });

  app.patch('/api/admin/listings/:type/:id/moderate', requireAdminPerm('moderate_ads'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const type = String(req.params.type);
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid listing ID.' });
        return;
      }
      const decision = cleanText(req.body?.decision, 30);
      const reason = cleanText(req.body?.reason, 400) || null;

      const statusMap: Record<string, string> = {
        approve: 'approved',
        reject: 'rejected',
        request_correction: 'correction_requested',
      };
      const nextStatus = statusMap[decision];
      if (!nextStatus) {
        res.status(400).json({ error: 'Invalid moderation decision.' });
        return;
      }
      if ((decision === 'reject' || decision === 'request_correction') && !reason) {
        res.status(400).json({ error: 'Please provide a reason for rejecting or requesting corrections.' });
        return;
      }

      let targetUserId: number | null = null;
      let targetTitle = '';

      if (type === 'job') {
        const [updated] = await db
          .update(jobs)
          .set({ approvalStatus: nextStatus, moderationReason: reason, updatedAt: new Date() })
          .where(eq(jobs.id, id))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'Job not found.' });
          return;
        }
        targetUserId = updated.userId;
        targetTitle = updated.title;
      } else if (type === 'market') {
        const [updated] = await db
          .update(marketItems)
          .set({ approvalStatus: nextStatus, moderationReason: reason, updatedAt: new Date() })
          .where(eq(marketItems.id, id))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'Market listing not found.' });
          return;
        }
        targetUserId = updated.userId;
        targetTitle = updated.title;
      } else if (type === 'house') {
        const [updated] = await db
          .update(houses)
          .set({ approvalStatus: nextStatus, moderationReason: reason, updatedAt: new Date() })
          .where(eq(houses.id, id))
          .returning();
        if (!updated) {
          res.status(404).json({ error: 'House listing not found.' });
          return;
        }
        targetUserId = updated.userId;
        targetTitle = updated.title;
      } else {
        res.status(400).json({ error: 'Invalid listing type.' });
        return;
      }

      if (targetUserId) {
        await notifyUser({
          userId: targetUserId,
          title:
            nextStatus === 'approved'
              ? 'Listing Approved'
              : nextStatus === 'rejected'
                ? 'Listing Rejected'
                : 'Corrections Requested',
          message:
            nextStatus === 'approved'
              ? `Your ${type} "${targetTitle}" is now live publicly.`
              : `Your ${type} "${targetTitle}" requires attention: ${reason}`,
          category: 'approval',
        });
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: `listing_${nextStatus}`,
        targetType: type,
        targetId: String(id),
        summary: `${admin.fullName} marked ${type} "${targetTitle}" as ${nextStatus}${reason ? ` (${reason})` : ''}`,
      });

      res.json({ ok: true, approvalStatus: nextStatus });
    } catch {
      res.status(500).json({ error: 'Failed to moderate listing.' });
    }
  });

  app.patch('/api/admin/listings/:type/:id', requireAdminPerm('moderate_ads'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const type = String(req.params.type);
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid listing ID.' });
        return;
      }
      const title = cleanText(req.body?.title, 120);
      const description = cleanText(req.body?.description, 2500);
      const lifecycleStatus = cleanText(req.body?.lifecycleStatus, 20);
      const expiresAtStr = typeof req.body?.expiresAt === 'string' ? req.body.expiresAt : '';
      const expiresAt = expiresAtStr ? new Date(expiresAtStr) : undefined;

      if (lifecycleStatus && !['active', 'filled', 'sold', 'rented', 'expired'].includes(lifecycleStatus)) {
        res.status(400).json({ error: 'Invalid lifecycle status.' });
        return;
      }

      let updatedRow: { id: number } | undefined;
      if (type === 'job') {
        [updatedRow] = await db
          .update(jobs)
          .set({
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
            ...(lifecycleStatus ? { lifecycleStatus } : {}),
            ...(expiresAt && !Number.isNaN(expiresAt.getTime()) ? { expiresAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, id))
          .returning({ id: jobs.id });
      } else if (type === 'market') {
        [updatedRow] = await db
          .update(marketItems)
          .set({
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
            ...(lifecycleStatus ? { lifecycleStatus } : {}),
            ...(expiresAt && !Number.isNaN(expiresAt.getTime()) ? { expiresAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(marketItems.id, id))
          .returning({ id: marketItems.id });
      } else if (type === 'house') {
        [updatedRow] = await db
          .update(houses)
          .set({
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
            ...(lifecycleStatus ? { lifecycleStatus } : {}),
            ...(expiresAt && !Number.isNaN(expiresAt.getTime()) ? { expiresAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(houses.id, id))
          .returning({ id: houses.id });
      } else {
        res.status(400).json({ error: 'Invalid listing type.' });
        return;
      }

      if (!updatedRow) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'admin_edited_listing',
        targetType: type,
        targetId: String(id),
        summary: `${admin.fullName} updated ${type} #${id}`,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to update listing.' });
    }
  });

  app.delete('/api/admin/listings/expired', requireAdminPerm('moderate_ads'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const now = new Date();
      const [d1, d2, d3] = await Promise.all([
        db
          .delete(jobs)
          .where(or(eq(jobs.lifecycleStatus, 'expired'), lte(jobs.expiresAt, now)))
          .returning({ id: jobs.id }),
        db
          .delete(marketItems)
          .where(or(eq(marketItems.lifecycleStatus, 'expired'), lte(marketItems.expiresAt, now)))
          .returning({ id: marketItems.id }),
        db
          .delete(houses)
          .where(or(eq(houses.lifecycleStatus, 'expired'), lte(houses.expiresAt, now)))
          .returning({ id: houses.id }),
      ]);
      const removed = d1.length + d2.length + d3.length;

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'expired_ads_purged',
        summary: `${admin.fullName} removed ${removed} expired advertisement(s)`,
      });

      res.json({ ok: true, removed });
    } catch {
      res.status(500).json({ error: 'Failed to remove expired advertisements.' });
    }
  });

  app.delete('/api/admin/listings/:type/:id', requireAdminPerm('moderate_ads'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const type = String(req.params.type);
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid listing ID.' });
        return;
      }

      let deletedRow: { id: number } | undefined;
      if (type === 'job') {
        [deletedRow] = await db.delete(jobs).where(eq(jobs.id, id)).returning({ id: jobs.id });
      } else if (type === 'market') {
        [deletedRow] = await db.delete(marketItems).where(eq(marketItems.id, id)).returning({ id: marketItems.id });
      } else if (type === 'house') {
        [deletedRow] = await db.delete(houses).where(eq(houses.id, id)).returning({ id: houses.id });
      } else {
        res.status(400).json({ error: 'Invalid listing type.' });
        return;
      }

      if (!deletedRow) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
      }

      await db
        .update(reports)
        .set({ status: 'resolved', resolutionNote: 'Listing removed by moderator' })
        .where(and(eq(reports.listingType, type), eq(reports.listingId, id)));

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'admin_deleted_listing',
        targetType: type,
        targetId: String(id),
        summary: `${admin.fullName} deleted ${type} #${id}`,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete listing.' });
    }
  });

  // Sponsorships & Payments Management
  app.get('/api/admin/sponsorships', requireAdminPerm(['manage_sponsorships', 'manage_payments']), async (_req, res) => {
    try {
      await expireStaleSponsorships();
      const [plans, paymentsRows, activeJobs, activeMarket, activeHouses] = await Promise.all([
        db.select().from(sponsorshipPlans).orderBy(sponsorshipPlans.durationDays),
        db
          .select({
            payment: sponsorshipPayments,
            userName: users.fullName,
            userPhone: users.whatsapp,
          })
          .from(sponsorshipPayments)
          .leftJoin(users, eq(sponsorshipPayments.userId, users.id))
          .orderBy(desc(sponsorshipPayments.createdAt))
          .limit(200),
        db.select().from(jobs).where(eq(jobs.isSponsored, true)),
        db.select().from(marketItems).where(eq(marketItems.isSponsored, true)),
        db.select().from(houses).where(eq(houses.isSponsored, true)),
      ]);

      const payments = paymentsRows.map((r) => ({
        ...r.payment,
        userName: r.userName ?? 'Member',
        userPhone: r.userPhone ?? '',
      }));

      const totalRevenueUsd = payments
        .filter((p) => p.status === 'confirmed' || p.status === 'expired')
        .reduce((acc, p) => acc + p.amountUsd, 0);

      const activeListings = [
        ...activeJobs.map((j) => ({
          type: 'job' as const,
          id: j.id,
          title: j.title,
          authorName: j.authorName,
          approvalStatus: j.approvalStatus,
          sponsoredUntil: j.sponsoredUntil,
        })),
        ...activeMarket.map((m) => ({
          type: 'market' as const,
          id: m.id,
          title: m.title,
          authorName: m.authorName,
          approvalStatus: m.approvalStatus,
          sponsoredUntil: m.sponsoredUntil,
        })),
        ...activeHouses.map((h) => ({
          type: 'house' as const,
          id: h.id,
          title: h.title,
          authorName: h.authorName,
          approvalStatus: h.approvalStatus,
          sponsoredUntil: h.sponsoredUntil,
        })),
      ];

      res.json({
        summary: {
          pendingPayments: payments.filter((p) => p.status === 'pending').length,
          confirmedPayments: payments.filter((p) => p.status === 'confirmed').length,
          expiredSponsorships: payments.filter((p) => p.status === 'expired').length,
          activeSponsoredPosts: activeListings.length,
          totalRevenueUsd,
        },
        plans,
        payments,
        activeListings,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load sponsorship dashboard.' });
    }
  });

  app.post('/api/admin/sponsorship-plans', requireAdminPerm('manage_sponsorships'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const name = cleanText(req.body?.name, 60);
      const durationDays = Math.max(1, Math.min(365, Number(req.body?.durationDays) || 7));
      const priceUsd = Math.max(0.5, Number(req.body?.priceUsd) || 5);

      if (!name) {
        res.status(400).json({ error: 'Plan name is required.' });
        return;
      }

      const [created] = await db
        .insert(sponsorshipPlans)
        .values({ name, durationDays, priceUsd, isActive: true })
        .returning();

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'sponsorship_plan_created',
        summary: `${admin.fullName} created sponsorship plan "${name}" (${durationDays}d · $${priceUsd})`,
      });

      res.status(201).json({ plan: created });
    } catch {
      res.status(500).json({ error: 'Failed to create sponsorship plan.' });
    }
  });

  app.put('/api/admin/sponsorship-plans/:id', requireAdminPerm('manage_sponsorships'), async (req: AuthedAdminRequest, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid sponsorship plan ID.' });
        return;
      }
      const name = cleanText(req.body?.name, 60);
      const durationDays = Number(req.body?.durationDays);
      const priceUsd = Number(req.body?.priceUsd);
      const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;

      const [updated] = await db
        .update(sponsorshipPlans)
        .set({
          ...(name ? { name } : {}),
          ...(Number.isFinite(durationDays) && durationDays > 0 ? { durationDays: Math.round(durationDays) } : {}),
          ...(Number.isFinite(priceUsd) && priceUsd > 0 ? { priceUsd } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        })
        .where(eq(sponsorshipPlans.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Sponsorship plan not found.' });
        return;
      }
      res.json({ plan: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update sponsorship plan.' });
    }
  });

  app.patch('/api/admin/payments/:id', requireAdminPerm('manage_payments'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const paymentId = parsePositiveId(req.params.id);
      if (!paymentId) {
        res.status(400).json({ error: 'Invalid payment ID.' });
        return;
      }
      const action = req.body?.action === 'confirm' ? 'confirm' : req.body?.action === 'reject' ? 'reject' : null;
      const adminNote = cleanText(req.body?.adminNote, 300) || null;

      if (!action) {
        res.status(400).json({ error: 'Specify action "confirm" or "reject".' });
        return;
      }

      const [payment] = await db
        .select()
        .from(sponsorshipPayments)
        .where(eq(sponsorshipPayments.id, paymentId))
        .limit(1);

      if (!payment) {
        res.status(404).json({ error: 'Payment record not found.' });
        return;
      }
      if (payment.status !== 'pending') {
        res.status(400).json({ error: `Payment is already ${payment.status}.` });
        return;
      }

      if (action === 'reject') {
        const [updated] = await db
          .update(sponsorshipPayments)
          .set({
            status: 'rejected',
            adminNote,
            confirmedByAdminId: admin.id,
          })
          .where(eq(sponsorshipPayments.id, paymentId))
          .returning();

        await db
          .update(paymentTransactions)
          .set({ status: 'failed', adminNote, confirmedByAdminId: admin.id, updatedAt: new Date() })
          .where(sql`(${paymentTransactions.metadataJson}->>'legacySponsorshipPaymentId')::int = ${paymentId}`);

        await notifyUser({
          userId: payment.userId,
          title: 'Sponsorship Payment Not Confirmed',
          message: `Payment reference "${payment.paymentReference}" for "${payment.listingTitle}" could not be confirmed.${adminNote ? ` Note: ${adminNote}` : ''}`,
          category: 'sponsorship',
        });

        await logAudit({
          actorType: 'admin',
          actorId: String(admin.id),
          actorName: admin.fullName,
          action: 'payment_rejected',
          targetType: payment.listingType,
          targetId: String(payment.listingId),
          summary: `${admin.fullName} rejected sponsorship payment #${paymentId} (${payment.paymentReference})`,
        });

        res.json({ payment: updated });
        return;
      }

      // Confirm payment -> activate sponsorship on listing (only if listing exists; public display still requires approvalStatus='approved')
      const startsAt = new Date();
      const expiresAt = new Date(startsAt.getTime() + 1000 * 60 * 60 * 24 * payment.durationDays);

      await db.transaction(async (tx) => {
        await tx
          .update(sponsorshipPayments)
          .set({
            status: 'confirmed',
            adminNote,
            confirmedByAdminId: admin.id,
            startsAt,
            expiresAt,
          })
          .where(eq(sponsorshipPayments.id, paymentId));

        await tx
          .update(paymentTransactions)
          .set({
            status: 'paid',
            adminNote,
            confirmedByAdminId: admin.id,
            paidAt: startsAt,
            updatedAt: startsAt,
          })
          .where(sql`(${paymentTransactions.metadataJson}->>'legacySponsorshipPaymentId')::int = ${paymentId}`);

        if (payment.listingType === 'job') {
          await tx
            .update(jobs)
            .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: startsAt })
            .where(eq(jobs.id, payment.listingId));
        } else if (payment.listingType === 'market') {
          await tx
            .update(marketItems)
            .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: startsAt })
            .where(eq(marketItems.id, payment.listingId));
        } else if (payment.listingType === 'house') {
          await tx
            .update(houses)
            .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: startsAt })
            .where(eq(houses.id, payment.listingId));
        }
      });

      await notifyUser({
        userId: payment.userId,
        title: 'Sponsorship Activated',
        message: `Payment confirmed for "${payment.listingTitle}". Sponsorship runs for ${payment.durationDays} days (requires post approval to appear publicly).`,
        category: 'sponsorship',
      });

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'payment_confirmed',
        targetType: payment.listingType,
        targetId: String(payment.listingId),
        summary: `${admin.fullName} confirmed $${payment.amountUsd} payment (${payment.paymentReference}) and activated ${payment.durationDays}-day sponsorship for "${payment.listingTitle}"`,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to process payment confirmation.' });
    }
  });

  // Categories Management
  app.get('/api/admin/categories', requireAdminPerm('manage_categories'), async (_req, res) => {
    try {
      const rows = await db.select().from(categories).orderBy(categories.section, categories.sortOrder, categories.name);
      res.json({ categories: rows });
    } catch {
      res.status(500).json({ error: 'Failed to load categories.' });
    }
  });

  app.post('/api/admin/categories', requireAdminPerm('manage_categories'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const section = cleanText(req.body?.section, 20);
      const name = cleanText(req.body?.name, 60);
      if (!['job', 'market', 'house'].includes(section) || !name) {
        res.status(400).json({ error: 'Section and category name are required.' });
        return;
      }
      const [created] = await db.insert(categories).values({ section, name, isActive: true }).returning();
      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'category_created',
        summary: `${admin.fullName} added ${section} category "${name}"`,
      });
      res.status(201).json({ category: created });
    } catch {
      res.status(500).json({ error: 'Failed to create category.' });
    }
  });

  app.delete('/api/admin/categories/:id', requireAdminPerm('manage_categories'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid category ID.' });
        return;
      }
      const [deleted] = await db.delete(categories).where(eq(categories.id, id)).returning();
      if (!deleted) {
        res.status(404).json({ error: 'Category not found.' });
        return;
      }
      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'category_deleted',
        summary: `${admin.fullName} removed ${deleted.section} category "${deleted.name}"`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete category.' });
    }
  });

  // Reports Management
  app.get('/api/admin/reports', requireAdminPerm('manage_reports'), async (_req, res) => {
    try {
      const rows = await db.select().from(reports).orderBy(desc(reports.createdAt)).limit(200);
      res.json({ reports: rows });
    } catch {
      res.status(500).json({ error: 'Failed to load reports.' });
    }
  });

  app.patch('/api/admin/reports/:id', requireAdminPerm('manage_reports'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid report ID.' });
        return;
      }
      const status = cleanText(req.body?.status, 20);
      const resolutionNote = cleanText(req.body?.resolutionNote, 300) || null;
      if (!['open', 'resolved', 'dismissed'].includes(status)) {
        res.status(400).json({ error: 'Invalid report status.' });
        return;
      }

      const [updated] = await db
        .update(reports)
        .set({ status, resolutionNote })
        .where(eq(reports.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Report not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'report_updated',
        targetType: 'report',
        targetId: String(id),
        summary: `${admin.fullName} marked report #${id} on "${updated.listingTitle}" as ${status}`,
      });

      res.json({ report: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update report.' });
    }
  });

  // Administrators & Permissions (Super Admin Only!)
  app.get('/api/admin/admins', requireAdminPerm('manage_admins'), async (_req, res) => {
    try {
      const rows = await db
        .select({
          id: admins.id,
          username: admins.username,
          fullName: admins.fullName,
          role: admins.role,
          permissions: admins.permissions,
          isActive: admins.isActive,
          createdAt: admins.createdAt,
        })
        .from(admins)
        .orderBy(admins.createdAt);
      res.json({ admins: rows, allPermissions: ALL_PERMISSIONS });
    } catch {
      res.status(500).json({ error: 'Failed to load administrators.' });
    }
  });

  app.post('/api/admin/admins', requireAdminPerm('manage_admins'), async (req: AuthedAdminRequest, res) => {
    try {
      const actor = req.currentAdmin!;
      if (actor.role !== 'super_admin') {
        res.status(403).json({ error: 'Only Super Admin can create administrator accounts.' });
        return;
      }

      const username = cleanText(req.body?.username, 40).toLowerCase();
      const fullName = cleanText(req.body?.fullName, 80);
      const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
      const role = cleanText(req.body?.role, 30);

      if (!username || !/^[a-z0-9_.-]+$/.test(username) || username.length < 3) {
        res.status(400).json({ error: 'Username must be at least 3 alphanumeric characters.' });
        return;
      }
      if (fullName.length < 2 || password.length < 8) {
        res.status(400).json({ error: 'Full name and password (8+ characters) are required.' });
        return;
      }
      if (!['moderator', 'user_manager', 'sponsorship_manager', 'super_admin'].includes(role)) {
        res.status(400).json({ error: 'Invalid administrator role.' });
        return;
      }

      const customPermissions = Array.isArray(req.body?.permissions)
        ? req.body.permissions.filter((p: unknown): p is AdminPermission =>
            ALL_PERMISSIONS.includes(p as AdminPermission)
          )
        : ROLE_DEFAULT_PERMISSIONS[role];

      const [created] = await db
        .insert(admins)
        .values({
          username,
          fullName,
          passwordHash: hashPassword(password),
          role,
          permissions: role === 'super_admin' ? [...ALL_PERMISSIONS] : customPermissions,
          isActive: true,
        })
        .returning({
          id: admins.id,
          username: admins.username,
          fullName: admins.fullName,
          role: admins.role,
          permissions: admins.permissions,
          isActive: admins.isActive,
          createdAt: admins.createdAt,
        });

      await logAudit({
        actorType: 'admin',
        actorId: String(actor.id),
        actorName: actor.fullName,
        action: 'admin_created',
        targetType: 'admin',
        targetId: String(created.id),
        summary: `${actor.fullName} created ${role} account "${username}"`,
      });

      res.status(201).json({ admin: created });
    } catch {
      res.status(400).json({ error: 'Username already exists or invalid payload.' });
    }
  });

  app.patch('/api/admin/admins/:id', requireAdminPerm('manage_admins'), async (req: AuthedAdminRequest, res) => {
    try {
      const actor = req.currentAdmin!;
      if (actor.role !== 'super_admin') {
        res.status(403).json({ error: 'Only Super Admin can modify administrator permissions.' });
        return;
      }

      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid administrator ID.' });
        return;
      }
      if (id === actor.id && req.body?.isActive === false) {
        res.status(400).json({ error: 'You cannot deactivate your own Super Admin account.' });
        return;
      }

      const role = typeof req.body?.role === 'string' ? req.body.role : undefined;
      const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;
      const permissions = Array.isArray(req.body?.permissions)
        ? req.body.permissions.filter((p: unknown): p is AdminPermission =>
            ALL_PERMISSIONS.includes(p as AdminPermission)
          )
        : undefined;

      const [updated] = await db
        .update(admins)
        .set({
          ...(role && ['moderator', 'user_manager', 'sponsorship_manager', 'super_admin'].includes(role)
            ? { role }
            : {}),
          ...(permissions ? { permissions } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        })
        .where(eq(admins.id, id))
        .returning({
          id: admins.id,
          username: admins.username,
          fullName: admins.fullName,
          role: admins.role,
          permissions: admins.permissions,
          isActive: admins.isActive,
          createdAt: admins.createdAt,
        });

      if (!updated) {
        res.status(404).json({ error: 'Administrator not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(actor.id),
        actorName: actor.fullName,
        action: 'admin_permissions_updated',
        targetType: 'admin',
        targetId: String(id),
        summary: `${actor.fullName} updated permissions/status for "${updated.username}"`,
      });

      res.json({ admin: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update administrator.' });
    }
  });

  // Audit Logs
  app.get('/api/admin/logs', requireAdminPerm('view_logs'), async (_req, res) => {
    try {
      const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
      res.json({ logs: rows });
    } catch {
      res.status(500).json({ error: 'Failed to load audit logs.' });
    }
  });

  // Settings & Data Export Backup
  app.get('/api/admin/settings', requireAdminPerm('manage_settings'), async (_req, res) => {
    try {
      const [paymentInstructions, listingExpiryDays] = await Promise.all([
        getSettingValue('payment_instructions', ''),
        getSettingValue('listing_expiry_days', '30'),
      ]);
      res.json({ paymentInstructions, listingExpiryDays: Number(listingExpiryDays) || 30 });
    } catch {
      res.status(500).json({ error: 'Failed to load settings.' });
    }
  });

  app.put('/api/admin/settings', requireAdminPerm('manage_settings'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const paymentInstructions = cleanText(req.body?.paymentInstructions, 500);
      const listingExpiryDays = Math.max(1, Math.min(365, Number(req.body?.listingExpiryDays) || 30));

      await Promise.all([
        db
          .insert(platformSettings)
          .values({ key: 'payment_instructions', value: paymentInstructions, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: paymentInstructions, updatedAt: new Date() },
          }),
        db
          .insert(platformSettings)
          .values({ key: 'listing_expiry_days', value: String(listingExpiryDays), updatedAt: new Date() })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: String(listingExpiryDays), updatedAt: new Date() },
          }),
      ]);

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'settings_updated',
        summary: `${admin.fullName} updated platform settings`,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to save settings.' });
    }
  });

  app.get('/api/admin/export-backup', requireAdminPerm('manage_settings'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const [
        allUsers,
        allJobs,
        allMarket,
        allHouses,
        allPayments,
        allCentralTx,
        allDatingProfiles,
        allDatingSubs,
        allReports,
        allCategories,
      ] = await Promise.all([
        db.select().from(users),
        db.select().from(jobs),
        db.select().from(marketItems),
        db.select().from(houses),
        db.select().from(sponsorshipPayments),
        db.select().from(paymentTransactions),
        db.select().from(datingProfiles),
        db.select().from(datingSubscriptions),
        db.select().from(reports),
        db.select().from(categories),
      ]);

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'backup_exported',
        summary: `${admin.fullName} exported full PostgreSQL JSON backup snapshot`,
      });

      res.setHeader('Content-Disposition', `attachment; filename="market_jobs_backup_${Date.now()}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        users: allUsers.map(toPublicUser),
        jobs: allJobs,
        marketItems: allMarket,
        houses: allHouses,
        sponsorshipPayments: allPayments,
        paymentTransactions: allCentralTx,
        datingProfiles: allDatingProfiles,
        datingSubscriptions: allDatingSubs,
        reports: allReports,
        categories: allCategories,
      });
    } catch {
      res.status(500).json({ error: 'Failed to export backup.' });
    }
  });

  // Register Dating/Singles & Central Payment System Routes
  registerDatingAndPaymentRoutes(app, {
    requireUserAuth: requireUserAuth as express.RequestHandler,
    requireAdminPerm: (perm) => requireAdminPerm(perm) as express.RequestHandler,
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MARKET & JOBS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
