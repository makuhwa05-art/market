import crypto from 'node:crypto';
import express from 'express';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  datingBlocks,
  datingPackages,
  datingProfiles,
  datingSelections,
  datingSubscriptions,
  houses,
  jobs,
  marketItems,
  paymentTransactions,
  platformSettings,
  reports,
  sponsorshipPayments,
  sponsorshipPlans,
  users,
} from '../src/db/schema.ts';
import {
  captureAndVerifyPayPalOrder,
  createPayPalOrder,
  fulfillPaidTransaction,
  getGatewayCapabilities,
  initiatePaynowCheckout,
  pollPaynowStatus,
  refundCentralTransaction,
  resolveBaseUrlFromRequest,
  verifyPaynowResponseHash,
  verifyPayPalWebhookSignature,
  type PaymentFeatureType,
  type PaymentGateway,
} from './payments.ts';
import { isValidZimbabwePhone, normalizeZimbabwePhone, sanitizeImageValue } from './phone.ts';
import {
  ensureSeeded,
  expireStaleDatingSubscriptions,
  getActiveDatingSubscription,
  logAudit,
  notifyUser,
  type AdminPermission,
} from './repository.ts';

type DbUser = typeof users.$inferSelect;
type DbAdmin = { id: number; username: string; fullName: string; role: string; permissions: string[] };

interface AuthedUserRequest extends express.Request {
  currentUser?: DbUser;
}

interface AuthedAdminRequest extends express.Request {
  currentAdmin?: DbAdmin;
}

function cleanText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function parsePositiveId(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeAnyDatingPhone(input: string, country: string): { valid: boolean; normalized: string } {
  const trimmed = String(input || '').trim();
  if (!trimmed) return { valid: false, normalized: '' };
  if (country.toLowerCase() === 'zimbabwe' || /^0[78]\d{8}$/.test(trimmed.replace(/\s+/g, ''))) {
    const norm = normalizeZimbabwePhone(trimmed);
    return { valid: isValidZimbabwePhone(trimmed), normalized: norm };
  }
  const digits = trimmed.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : `+${digits}`;
  return { valid: /^\+\d{8,15}$/.test(e164), normalized: e164 };
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  return row?.value ?? fallback;
}

export function registerDatingAndPaymentRoutes(
  app: express.Express,
  deps: {
    requireUserAuth: express.RequestHandler;
    requireAdminPerm: (perm?: AdminPermission | AdminPermission[]) => express.RequestHandler;
  }
) {
  const { requireUserAuth, requireAdminPerm } = deps;

  // Paynow Server-to-Server Result Webhook (expects raw urlencoded payload to preserve field order for SHA-512 hash check)
  app.post(
    '/api/payments/paynow/webhook',
    express.text({ type: ['application/x-www-form-urlencoded', 'text/plain', '*/*'] }),
    async (req, res) => {
      try {
        await ensureSeeded();
        const integrationKey = (process.env.PAYNOW_INTEGRATION_KEY ?? '').trim();
        if (!integrationKey) {
          res.status(503).send('Paynow not configured');
          return;
        }
        const rawBody =
          typeof req.body === 'string'
            ? req.body
            : new URLSearchParams(req.body as Record<string, string>).toString();

        const verified = verifyPaynowResponseHash(rawBody, integrationKey);
        if (!verified) {
          res.status(400).send('Invalid signature');
          return;
        }

        const reference = (verified.reference ?? '').trim();
        const status = (verified.status ?? '').trim().toLowerCase();
        const amount = Number(verified.amount ?? 0);
        const paynowRef = verified.paynowreference ?? null;

        if (!reference) {
          res.status(400).send('Missing reference');
          return;
        }

        const [txRow] = await db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.merchantReference, reference))
          .limit(1);

        if (!txRow) {
          res.status(404).send('Transaction not found');
          return;
        }

        if (status === 'paid' && Number.isFinite(amount) && amount >= txRow.amountUsd - 0.01) {
          await fulfillPaidTransaction({
            transactionId: txRow.id,
            gatewayReference: paynowRef || txRow.gatewayReference,
          });
        } else if (status === 'cancelled' || status === 'failed' || status === 'disputed') {
          await db
            .update(paymentTransactions)
            .set({ status: 'failed', adminNote: `Paynow status: ${verified.status}`, updatedAt: new Date() })
            .where(and(eq(paymentTransactions.id, txRow.id), eq(paymentTransactions.status, 'pending')));
        }

        res.status(200).send('OK');
      } catch (err) {
        console.error('Paynow webhook error:', err);
        res.status(500).send('Webhook processing failed');
      }
    }
  );

  // PayPal Webhook Handler
  app.post('/api/payments/paypal/webhook', express.json(), async (req, res) => {
    try {
      await ensureSeeded();
      const verified = await verifyPayPalWebhookSignature({
        headers: req.headers,
        rawBody: req.body,
      });
      if (!verified) {
        res.status(400).json({ error: 'Invalid PayPal webhook signature.' });
        return;
      }

      const event = req.body as {
        event_type?: string;
        resource?: {
          id?: string;
          custom_id?: string;
          amount?: { value?: string; currency_code?: string };
          supplementary_data?: { related_ids?: { order_id?: string } };
        };
      };

      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const customId = event.resource?.custom_id;
        const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
        const captureId = event.resource?.id;
        const paidAmount = Number(event.resource?.amount?.value ?? 0);
        const currency = event.resource?.amount?.currency_code;

        const txRows = await db
          .select()
          .from(paymentTransactions)
          .where(
            customId
              ? eq(paymentTransactions.merchantReference, customId)
              : eq(paymentTransactions.gatewayReference, orderId || '')
          )
          .limit(1);

        const txRow = txRows[0];
        if (txRow && currency === 'USD' && paidAmount >= txRow.amountUsd - 0.01) {
          await fulfillPaidTransaction({
            transactionId: txRow.id,
            gatewayReference: orderId || txRow.gatewayReference,
            gatewayCaptureId: captureId || txRow.gatewayCaptureId,
          });
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error('PayPal webhook error:', err);
      res.status(500).json({ error: 'PayPal webhook error.' });
    }
  });

  // ============================================================================
  // Dating Packages & Profile Management
  // ============================================================================
  app.get('/api/dating/packages', async (_req, res) => {
    try {
      await ensureSeeded();
      const packages = await db
        .select()
        .from(datingPackages)
        .where(eq(datingPackages.isActive, true))
        .orderBy(datingPackages.priceUsd);
      res.json({ packages });
    } catch {
      res.status(500).json({ error: 'Failed to load dating packages.' });
    }
  });

  app.get('/api/dating/me', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      await expireStaleDatingSubscriptions();

      const [datingEnabled, allowHivDisclosure] = await Promise.all([
        getSetting('dating_enabled', 'true'),
        getSetting('dating_allow_hiv_disclosure', 'true'),
      ]);

      const [profileRows, activeSub, pastSubs, blockRows] = await Promise.all([
        db.select().from(datingProfiles).where(eq(datingProfiles.userId, user.id)).limit(1),
        getActiveDatingSubscription(user.id),
        db
          .select()
          .from(datingSubscriptions)
          .where(eq(datingSubscriptions.userId, user.id))
          .orderBy(desc(datingSubscriptions.createdAt))
          .limit(15),
        db.select().from(datingBlocks).where(eq(datingBlocks.blockerUserId, user.id)),
      ]);

      const profile = profileRows[0] ?? null;

      // Load chosen profiles (only return WhatsApp for profiles user already chose while holding a subscription)
      const selectionRows = await db
        .select({
          selection: datingSelections,
          target: datingProfiles,
          targetVerified: users.verificationStatus,
        })
        .from(datingSelections)
        .innerJoin(datingProfiles, eq(datingSelections.targetProfileId, datingProfiles.id))
        .leftJoin(users, eq(datingProfiles.userId, users.id))
        .where(eq(datingSelections.userId, user.id))
        .orderBy(desc(datingSelections.createdAt));

      const remainingSelections = activeSub
        ? activeSub.isUnlimited
          ? null
          : Math.max(0, (activeSub.selectionLimit ?? 0) - activeSub.selectionsUsed)
        : 0;

      res.json({
        datingEnabled: datingEnabled === 'true',
        allowHivDisclosure: allowHivDisclosure === 'true',
        datingOptIn: user.datingOptIn,
        profile,
        activeSubscription: activeSub
          ? { ...activeSub, remainingSelections }
          : null,
        subscriptions: pastSubs,
        blockedProfileIds: blockRows.map((b) => b.blockedProfileId),
        selections: selectionRows.map((r) => ({
          id: r.selection.id,
          createdAt: r.selection.createdAt,
          profileId: r.target.id,
          displayName: r.target.displayName,
          age: r.target.age,
          gender: r.target.gender,
          country: r.target.country,
          city: r.target.city,
          suburb: r.target.suburb,
          photo: r.target.photo,
          intention: r.target.intention,
          whatsapp: r.target.whatsapp,
          isVerified: r.targetVerified === 'verified',
        })),
      });
    } catch (err) {
      console.error('Failed to load dating status:', err);
      res.status(500).json({ error: 'Could not load your dating profile.' });
    }
  });

  app.put('/api/dating/profile', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const displayName = cleanText(req.body?.displayName, 60);
      const age = Number(req.body?.age);
      const gender = cleanText(req.body?.gender, 15).toLowerCase();
      const country = cleanText(req.body?.country, 60) || 'Zimbabwe';
      const city = cleanText(req.body?.city, 60);
      const suburb = cleanText(req.body?.suburb, 80);
      const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.whatsapp;
      const photo = sanitizeImageValue(req.body?.photo);
      const childrenRaw = req.body?.childrenCount;
      const childrenCount =
        childrenRaw === null || childrenRaw === undefined || childrenRaw === ''
          ? null
          : Math.max(0, Math.min(20, Math.round(Number(childrenRaw))));
      const hivStatusRaw = cleanText(req.body?.hivStatus, 40) || 'Prefer not to disclose';
      const hivStatus = ['Positive', 'Negative', 'Prefer not to disclose'].includes(hivStatusRaw)
        ? hivStatusRaw
        : 'Prefer not to disclose';
      const shareHivWithSubscribers =
        hivStatus === 'Prefer not to disclose' ? false : Boolean(req.body?.shareHivWithSubscribers);
      const description = cleanText(req.body?.description, 1000);
      const intentionRaw = cleanText(req.body?.intention, 30) || 'serious_relationship';
      const intention = ['dating', 'serious_relationship', 'marriage'].includes(intentionRaw)
        ? intentionRaw
        : 'serious_relationship';
      const termsAccepted = Boolean(req.body?.termsAccepted);
      const isVisible = typeof req.body?.isVisible === 'boolean' ? req.body.isVisible : true;

      if (!Number.isInteger(age) || age < 18 || age > 99) {
        res.status(400).json({ error: 'Only adults aged 18 and above can join the Singles section.' });
        return;
      }
      if (!termsAccepted) {
        res.status(400).json({ error: 'You must accept the Dating Safety & Privacy Terms to join.' });
        return;
      }
      if (gender !== 'male' && gender !== 'female') {
        res.status(400).json({ error: 'Please select male or female gender.' });
        return;
      }
      if (displayName.length < 2 || !city || !suburb || description.length < 10) {
        res.status(400).json({
          error: 'Please enter display name, city, suburb, and a short personal description (10+ chars).',
        });
        return;
      }
      if (!photo) {
        res.status(400).json({ error: 'A profile photo is required for the Singles section.' });
        return;
      }

      const phoneCheck = normalizeAnyDatingPhone(rawWhatsapp, country);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: 'Enter a valid WhatsApp number (e.g. 0771234567).' });
        return;
      }

      const requireApproval = (await getSetting('dating_require_approval', 'true')) === 'true';
      const [existing] = await db
        .select()
        .from(datingProfiles)
        .where(eq(datingProfiles.userId, user.id))
        .limit(1);

      const nextApprovalStatus = requireApproval ? 'pending' : 'approved';
      const now = new Date();

      let saved;
      if (existing) {
        const [updated] = await db
          .update(datingProfiles)
          .set({
            displayName,
            age,
            gender,
            country,
            city,
            suburb,
            whatsapp: phoneCheck.normalized,
            photo,
            childrenCount,
            hivStatus,
            shareHivWithSubscribers,
            description,
            intention,
            termsAccepted: true,
            isVisible,
            approvalStatus: nextApprovalStatus,
            moderationReason: null,
            updatedAt: now,
          })
          .where(eq(datingProfiles.userId, user.id))
          .returning();
        saved = updated;
      } else {
        const [created] = await db
          .insert(datingProfiles)
          .values({
            userId: user.id,
            displayName,
            age,
            gender,
            country,
            city,
            suburb,
            whatsapp: phoneCheck.normalized,
            photo,
            childrenCount,
            hivStatus,
            shareHivWithSubscribers,
            description,
            intention,
            termsAccepted: true,
            isVisible,
            approvalStatus: nextApprovalStatus,
          })
          .returning();
        saved = created;
      }

      await db
        .update(users)
        .set({ datingOptIn: 'yes', updatedAt: now })
        .where(eq(users.id, user.id));

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: existing ? 'dating_profile_updated' : 'dating_profile_created',
        targetType: 'dating',
        targetId: String(saved.id),
        summary: `${user.fullName} ${existing ? 'updated' : 'created'} dating profile (${gender}, ${age}, ${city})`,
      });

      res.json({ profile: saved });
    } catch (err) {
      console.error('Dating profile save error:', err);
      res.status(500).json({ error: 'Could not save dating profile.' });
    }
  });

  app.delete('/api/dating/profile', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      await db.delete(datingProfiles).where(eq(datingProfiles.userId, user.id));
      await db.update(users).set({ datingOptIn: 'no', updatedAt: new Date() }).where(eq(users.id, user.id));
      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'dating_profile_removed',
        targetType: 'user',
        targetId: String(user.id),
        summary: `${user.fullName} opted out and deleted their dating profile`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to remove dating profile.' });
    }
  });

  // Strict Heterosexual Opposite-Gender Singles Feed + Privacy Protection
  app.get('/api/dating/profiles', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const [datingEnabled, allowHivDisclosure] = await Promise.all([
        getSetting('dating_enabled', 'true'),
        getSetting('dating_allow_hiv_disclosure', 'true'),
      ]);

      if (datingEnabled !== 'true') {
        res.status(403).json({ error: 'The Singles section is currently disabled by an administrator.' });
        return;
      }

      const [viewerProfile] = await db
        .select()
        .from(datingProfiles)
        .where(eq(datingProfiles.userId, user.id))
        .limit(1);

      if (!viewerProfile) {
        res.json({
          requiresProfile: true,
          profiles: [],
          total: 0,
          page: 1,
          totalPages: 1,
          activeSubscription: null,
        });
        return;
      }

      if (viewerProfile.isSuspended) {
        res.status(403).json({ error: 'Your dating profile is currently suspended.' });
        return;
      }

      const oppositeGender = viewerProfile.gender === 'male' ? 'female' : 'male';
      const activeSub = await getActiveDatingSubscription(user.id);

      // Fetch block pairs in BOTH directions + viewer's already-chosen profile IDs
      const [blocksAsBlocker, blocksAsTarget, mySelections] = await Promise.all([
        db
          .select({ profileId: datingBlocks.blockedProfileId })
          .from(datingBlocks)
          .where(eq(datingBlocks.blockerUserId, user.id)),
        db
          .select({ blockerUserId: datingBlocks.blockerUserId })
          .from(datingBlocks)
          .where(eq(datingBlocks.blockedUserId, user.id)),
        db
          .select({ targetProfileId: datingSelections.targetProfileId })
          .from(datingSelections)
          .where(eq(datingSelections.userId, user.id)),
      ]);

      const blockedProfileIds = new Set(blocksAsBlocker.map((b) => b.profileId));
      const blockedByUserIds = new Set(blocksAsTarget.map((b) => b.blockerUserId));
      const chosenProfileIds = new Set(mySelections.map((s) => s.targetProfileId));

      const countryFilter = cleanText(req.query.country, 60);
      const cityFilter = cleanText(req.query.city, 60);
      const locationFilter = cleanText(req.query.location, 80);
      const qFilter = cleanText(req.query.q, 100);
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(36, Math.max(1, Number(req.query.limit) || 12));

      const conditions = [
        eq(datingProfiles.gender, oppositeGender),
        eq(datingProfiles.approvalStatus, 'approved'),
        eq(datingProfiles.isVisible, true),
        eq(datingProfiles.isSuspended, false),
        eq(users.accountStatus, 'active'),
        sql`${datingProfiles.userId} <> ${user.id}`,
      ];

      if (countryFilter && countryFilter !== 'All') {
        conditions.push(ilike(datingProfiles.country, countryFilter));
      }
      if (cityFilter && cityFilter !== 'All') {
        conditions.push(ilike(datingProfiles.city, cityFilter));
      }
      if (locationFilter) {
        const locPat = `%${locationFilter}%`;
        conditions.push(or(ilike(datingProfiles.suburb, locPat), ilike(datingProfiles.city, locPat))!);
      }
      if (qFilter) {
        const qPat = `%${qFilter}%`;
        conditions.push(
          or(
            ilike(datingProfiles.displayName, qPat),
            ilike(datingProfiles.description, qPat),
            ilike(datingProfiles.suburb, qPat),
            ilike(datingProfiles.city, qPat)
          )!
        );
      }

      const rows = await db
        .select({
          profile: datingProfiles,
          authorVerified: users.verificationStatus,
        })
        .from(datingProfiles)
        .innerJoin(users, eq(datingProfiles.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(datingProfiles.createdAt));

      const visibleRows = rows.filter(
        (r) => !blockedProfileIds.has(r.profile.id) && !blockedByUserIds.has(r.profile.userId)
      );

      const total = visibleRows.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = visibleRows.slice((page - 1) * limit, page * limit);
      const hasActivePaidPackage = Boolean(activeSub);

      // STRICT PRIVACY STRIPPING: never expose whatsapp in feed; never expose hivStatus without consent + active package!
      const sanitizedProfiles = paged.map((r) => {
        const p = r.profile;
        const canViewHiv =
          hasActivePaidPackage &&
          allowHivDisclosure === 'true' &&
          p.shareHivWithSubscribers &&
          p.hivStatus !== 'Prefer not to disclose';

        return {
          id: p.id,
          displayName: p.displayName,
          age: p.age,
          gender: p.gender,
          country: p.country,
          city: p.city,
          suburb: p.suburb,
          photo: p.photo,
          childrenCount: p.childrenCount,
          description: p.description,
          intention: p.intention,
          isVerified: r.authorVerified === 'verified',
          alreadyChosen: chosenProfileIds.has(p.id),
          hivShared: canViewHiv,
          ...(canViewHiv ? { hivStatus: p.hivStatus } : {}),
          createdAt: p.createdAt,
        };
      });

      const remainingSelections = activeSub
        ? activeSub.isUnlimited
          ? null
          : Math.max(0, (activeSub.selectionLimit ?? 0) - activeSub.selectionsUsed)
        : 0;

      res.json({
        requiresProfile: false,
        viewerGender: viewerProfile.gender,
        profiles: sanitizedProfiles,
        total,
        page,
        totalPages,
        activeSubscription: activeSub ? { ...activeSub, remainingSelections } : null,
      });
    } catch (err) {
      console.error('Failed to load dating profiles:', err);
      res.status(500).json({ error: 'Could not load singles profiles.' });
    }
  });

  // CHOOSE a single -> enforces active package & limit, records selection, reveals WhatsApp URL
  app.post('/api/dating/choose/:profileId', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const profileId = parsePositiveId(req.params.profileId);
      if (!profileId) {
        res.status(400).json({ error: 'Invalid profile selection.' });
        return;
      }

      const datingEnabled = await getSetting('dating_enabled', 'true');
      if (datingEnabled !== 'true') {
        res.status(403).json({ error: 'The Singles section is currently disabled.' });
        return;
      }

      const [viewerProfile] = await db
        .select()
        .from(datingProfiles)
        .where(eq(datingProfiles.userId, user.id))
        .limit(1);

      if (!viewerProfile || viewerProfile.isSuspended) {
        res.status(403).json({ error: 'Complete an active 18+ dating profile first.' });
        return;
      }

      const [targetRow] = await db
        .select({ profile: datingProfiles, ownerStatus: users.accountStatus })
        .from(datingProfiles)
        .innerJoin(users, eq(datingProfiles.userId, users.id))
        .where(eq(datingProfiles.id, profileId))
        .limit(1);

      if (
        !targetRow ||
        targetRow.profile.approvalStatus !== 'approved' ||
        !targetRow.profile.isVisible ||
        targetRow.profile.isSuspended ||
        targetRow.ownerStatus !== 'active'
      ) {
        res.status(404).json({ error: 'This profile is unavailable.' });
        return;
      }

      const target = targetRow.profile;
      if (target.userId === user.id || target.gender === viewerProfile.gender) {
        res.status(403).json({ error: 'This profile is not eligible for your selection.' });
        return;
      }

      // Check block in either direction
      const [blockExists] = await db
        .select()
        .from(datingBlocks)
        .where(
          or(
            and(eq(datingBlocks.blockerUserId, user.id), eq(datingBlocks.blockedProfileId, target.id)),
            and(eq(datingBlocks.blockerUserId, target.userId), eq(datingBlocks.blockedUserId, user.id))
          )
        )
        .limit(1);

      if (blockExists) {
        res.status(403).json({ error: 'You cannot contact a blocked profile.' });
        return;
      }

      await expireStaleDatingSubscriptions();

      const txResult = await db.transaction(async (tx) => {
        const [activeSub] = await tx
          .select()
          .from(datingSubscriptions)
          .where(and(eq(datingSubscriptions.userId, user.id), eq(datingSubscriptions.status, 'active')))
          .orderBy(desc(datingSubscriptions.createdAt))
          .limit(1);

        if (!activeSub) {
          return { status: 403 as const, error: 'Please purchase an active Dating Package before choosing singles.' };
        }

        // Check if already chosen in this subscription (or in any prior selection) -> idempotent without wasting a slot
        const [already] = await tx
          .select()
          .from(datingSelections)
          .where(and(eq(datingSelections.userId, user.id), eq(datingSelections.targetProfileId, target.id)))
          .limit(1);

        if (already) {
          const remaining = activeSub.isUnlimited
            ? null
            : Math.max(0, (activeSub.selectionLimit ?? 0) - activeSub.selectionsUsed);
          return {
            status: 200 as const,
            alreadyChosen: true,
            selection: already,
            subscription: { ...activeSub, remainingSelections: remaining },
          };
        }

        if (!activeSub.isUnlimited && activeSub.selectionLimit !== null && activeSub.selectionsUsed >= activeSub.selectionLimit) {
          await tx
            .update(datingSubscriptions)
            .set({ status: 'exhausted' })
            .where(eq(datingSubscriptions.id, activeSub.id));
          return {
            status: 403 as const,
            error: `You have used all ${activeSub.selectionLimit} selections in your ${activeSub.packageName}. Upgrade to choose more singles.`,
          };
        }

        const [inserted] = await tx
          .insert(datingSelections)
          .values({
            userId: user.id,
            subscriptionId: activeSub.id,
            targetProfileId: target.id,
            targetUserId: target.userId,
          })
          .returning();

        const nextUsed = activeSub.selectionsUsed + 1;
        const exhaustedNow = !activeSub.isUnlimited && activeSub.selectionLimit !== null && nextUsed >= activeSub.selectionLimit;

        const [updatedSub] = await tx
          .update(datingSubscriptions)
          .set({
            selectionsUsed: nextUsed,
            ...(exhaustedNow ? { status: 'exhausted' } : {}),
          })
          .where(eq(datingSubscriptions.id, activeSub.id))
          .returning();

        const remaining = updatedSub.isUnlimited
          ? null
          : Math.max(0, (updatedSub.selectionLimit ?? 0) - updatedSub.selectionsUsed);

        return {
          status: 200 as const,
          alreadyChosen: false,
          selection: inserted,
          subscription: { ...updatedSub, remainingSelections: remaining },
        };
      });

      if (txResult.status !== 200) {
        res.status(txResult.status).json({ error: txResult.error });
        return;
      }

      const introText = `Hi ${target.displayName}, I saw your profile on MARKET & JOBS Zimbabwe Singles (${viewerProfile.displayName} from ${viewerProfile.city}) and would love to connect and get to know you.`;
      const waDigits = target.whatsapp.replace(/^\+/, '');
      const whatsappUrl = `https://wa.me/${waDigits}?text=${encodeURIComponent(introText)}`;

      if (!txResult.alreadyChosen) {
        await logAudit({
          actorType: 'user',
          actorId: String(user.id),
          actorName: user.fullName,
          action: 'dating_profile_chosen',
          targetType: 'dating',
          targetId: String(target.id),
          summary: `${viewerProfile.displayName} selected ${target.displayName} under ${txResult.subscription.packageName}`,
        });
      }

      res.json({
        alreadyChosen: txResult.alreadyChosen,
        selection: txResult.selection,
        subscription: txResult.subscription,
        whatsapp: target.whatsapp,
        whatsappUrl,
      });
    } catch (err) {
      console.error('Dating choose error:', err);
      res.status(500).json({ error: 'Could not select profile.' });
    }
  });

  app.post('/api/dating/block/:profileId', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const profileId = parsePositiveId(req.params.profileId);
      if (!profileId) {
        res.status(400).json({ error: 'Invalid profile ID.' });
        return;
      }
      const [target] = await db
        .select()
        .from(datingProfiles)
        .where(eq(datingProfiles.id, profileId))
        .limit(1);

      if (!target) {
        res.status(404).json({ error: 'Profile not found.' });
        return;
      }

      await db
        .insert(datingBlocks)
        .values({
          blockerUserId: user.id,
          blockedProfileId: target.id,
          blockedUserId: target.userId,
        })
        .onConflictDoNothing();

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to block profile.' });
    }
  });

  app.delete('/api/dating/block/:profileId', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const profileId = parsePositiveId(req.params.profileId);
      if (!profileId) {
        res.status(400).json({ error: 'Invalid profile ID.' });
        return;
      }
      await db
        .delete(datingBlocks)
        .where(and(eq(datingBlocks.blockerUserId, user.id), eq(datingBlocks.blockedProfileId, profileId)));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to unblock profile.' });
    }
  });

  // ============================================================================
  // Central Payment System (Public/Member Routes)
  // ============================================================================
  app.get('/api/payments/methods', async (_req, res) => {
    try {
      await ensureSeeded();
      const [caps, instructions, packages, plans] = await Promise.all([
        Promise.resolve(getGatewayCapabilities()),
        getSetting('payment_instructions', ''),
        db.select().from(datingPackages).where(eq(datingPackages.isActive, true)).orderBy(datingPackages.priceUsd),
        db.select().from(sponsorshipPlans).where(eq(sponsorshipPlans.isActive, true)).orderBy(sponsorshipPlans.durationDays),
      ]);
      res.json({
        ...caps,
        paymentInstructions: instructions,
        datingPackages: packages,
        sponsorshipPlans: plans,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load payment methods.' });
    }
  });

  app.get('/api/payments/my', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const rows = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.userId, user.id))
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(50);
      res.json({ transactions: rows });
    } catch {
      res.status(500).json({ error: 'Failed to load your payment history.' });
    }
  });

  app.post('/api/payments/checkout', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const featureType = cleanText(req.body?.featureType, 30) as PaymentFeatureType;
      const gateway = cleanText(req.body?.gateway, 20) as PaymentGateway;
      const targetId = Number(req.body?.targetId);
      const planOrPackageId = Number(req.body?.planOrPackageId || req.body?.targetId);
      const manualMethod = cleanText(req.body?.manualMethod, 40) || 'EcoCash';
      const manualReference = cleanText(req.body?.manualReference, 120);

      if (!['dating_package', 'sponsored_job', 'sponsored_market', 'sponsored_house'].includes(featureType)) {
        res.status(400).json({ error: 'Invalid payment feature type.' });
        return;
      }
      if (!['paynow', 'paypal', 'manual'].includes(gateway)) {
        res.status(400).json({ error: 'Invalid payment gateway.' });
        return;
      }

      const caps = getGatewayCapabilities();
      if (gateway === 'paynow' && !caps.paynowConfigured) {
        res.status(503).json({
          error:
            'Paynow Zimbabwe credentials are not configured on this server yet. Please use EcoCash/InnBucks Manual Reference or contact the site administrator.',
        });
        return;
      }
      if (gateway === 'paypal' && !caps.paypalConfigured) {
        res.status(503).json({
          error:
            'PayPal credentials are not configured on this server yet. Please use EcoCash/InnBucks Manual Reference or contact the site administrator.',
        });
        return;
      }
      if (gateway === 'manual' && manualReference.length < 3) {
        res.status(400).json({ error: 'Please enter a valid payment transaction reference.' });
        return;
      }

      let amountUsd = 0;
      let targetTitle = '';
      let resolvedTargetId = targetId;
      let resolvedPlanId: number | null = null;
      const metadata: Record<string, unknown> = { manualMethod };

      if (featureType === 'dating_package') {
        const [viewerProfile] = await db
          .select()
          .from(datingProfiles)
          .where(eq(datingProfiles.userId, user.id))
          .limit(1);

        if (!viewerProfile || viewerProfile.age < 18 || !viewerProfile.termsAccepted) {
          res.status(400).json({
            error: 'Please complete your 18+ Singles profile and accept the Dating Terms before purchasing a package.',
          });
          return;
        }

        const [pkg] = await db
          .select()
          .from(datingPackages)
          .where(and(eq(datingPackages.id, planOrPackageId), eq(datingPackages.isActive, true)))
          .limit(1);

        if (!pkg) {
          res.status(404).json({ error: 'Selected dating package is unavailable.' });
          return;
        }
        amountUsd = pkg.priceUsd;
        targetTitle = pkg.name;
        resolvedTargetId = pkg.id;
        resolvedPlanId = pkg.id;
        metadata.packageSlug = pkg.slug;
      } else {
        const [plan] = await db
          .select()
          .from(sponsorshipPlans)
          .where(and(eq(sponsorshipPlans.id, planOrPackageId), eq(sponsorshipPlans.isActive, true)))
          .limit(1);

        if (!plan) {
          res.status(404).json({ error: 'Selected sponsorship plan is unavailable.' });
          return;
        }

        if (featureType === 'sponsored_job') {
          const [row] = await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.id, targetId), eq(jobs.userId, user.id)))
            .limit(1);
          targetTitle = row?.title ?? '';
        } else if (featureType === 'sponsored_market') {
          const [row] = await db
            .select()
            .from(marketItems)
            .where(and(eq(marketItems.id, targetId), eq(marketItems.userId, user.id)))
            .limit(1);
          targetTitle = row?.title ?? '';
        } else {
          const [row] = await db
            .select()
            .from(houses)
            .where(and(eq(houses.id, targetId), eq(houses.userId, user.id)))
            .limit(1);
          targetTitle = row?.title ?? '';
        }

        if (!targetTitle) {
          res.status(404).json({ error: 'Listing not found in your account.' });
          return;
        }

        amountUsd = plan.priceUsd;
        resolvedPlanId = plan.id;
        metadata.planId = plan.id;
        metadata.durationDays = plan.durationDays;
      }

      const merchantReference = `MJ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const baseUrl = resolveBaseUrlFromRequest(
        req.headers.origin as string | undefined,
        req.headers.host,
        req.protocol
      );

      let checkoutUrl: string | null = null;
      let pollUrl: string | null = null;
      let gatewayReference: string | null = gateway === 'manual' ? manualReference : null;

      if (gateway === 'paynow') {
        const pn = await initiatePaynowCheckout({
          merchantReference,
          amountUsd,
          title: `${featureType === 'dating_package' ? 'Singles' : 'Sponsored'}: ${targetTitle}`,
          userEmail: user.email,
          baseUrl,
        });
        checkoutUrl = pn.browserUrl;
        pollUrl = pn.pollUrl;
        gatewayReference = pn.paynowRef ?? null;
      } else if (gateway === 'paypal') {
        const pp = await createPayPalOrder({
          merchantReference,
          amountUsd,
          description: targetTitle,
          baseUrl,
        });
        checkoutUrl = pp.approveUrl;
        gatewayReference = pp.orderId;
      }

      // Sync manual sponsorships into sponsorshipPayments table too for backwards compatibility
      if (gateway === 'manual' && featureType !== 'dating_package') {
        const listingType =
          featureType === 'sponsored_job'
            ? 'job'
            : featureType === 'sponsored_market'
              ? 'market'
              : 'house';
        const [sp] = await db
          .insert(sponsorshipPayments)
          .values({
            userId: user.id,
            listingType,
            listingId: resolvedTargetId,
            listingTitle: targetTitle,
            planId: resolvedPlanId,
            durationDays: Number(metadata.durationDays || 7),
            amountUsd,
            paymentMethod: manualMethod,
            paymentReference: manualReference,
            status: 'pending',
          })
          .returning();
        metadata.legacySponsorshipPaymentId = sp.id;
      }

      const [created] = await db
        .insert(paymentTransactions)
        .values({
          userId: user.id,
          featureType,
          targetId: resolvedTargetId,
          targetTitle,
          planOrPackageId: resolvedPlanId,
          gateway,
          amountUsd,
          currency: 'USD',
          status: 'pending',
          merchantReference,
          gatewayReference,
          pollUrl,
          checkoutUrl,
          metadataJson: metadata,
        })
        .returning();

      await logAudit({
        actorType: 'user',
        actorId: String(user.id),
        actorName: user.fullName,
        action: 'payment_initiated',
        targetType: featureType,
        targetId: String(created.id),
        summary: `${user.fullName} initiated $${amountUsd} ${gateway.toUpperCase()} payment (${merchantReference}) for "${targetTitle}"`,
      });

      res.status(201).json({
        transaction: created,
        checkoutUrl,
        orderId: gateway === 'paypal' ? gatewayReference : undefined,
      });
    } catch (err) {
      console.error('Payment checkout error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not initiate payment.',
      });
    }
  });

  // Server-side Payment Verification (Paynow poll OR PayPal capture) — never activates from URL params alone!
  app.post('/api/payments/verify', requireUserAuth, async (req: AuthedUserRequest, res) => {
    try {
      const user = req.currentUser!;
      const merchantReference = cleanText(req.body?.merchantReference, 120);
      const transactionId = parsePositiveId(req.body?.transactionId);
      const paypalOrderId = cleanText(req.body?.paypalOrderId, 120);

      if (!merchantReference && !transactionId) {
        res.status(400).json({ error: 'Provide a valid merchantReference or transactionId.' });
        return;
      }

      const whereClause = merchantReference
        ? and(eq(paymentTransactions.merchantReference, merchantReference), eq(paymentTransactions.userId, user.id))
        : and(eq(paymentTransactions.id, transactionId!), eq(paymentTransactions.userId, user.id));

      const [txRow] = await db.select().from(paymentTransactions).where(whereClause).limit(1);
      if (!txRow) {
        res.status(404).json({ error: 'Payment transaction not found.' });
        return;
      }

      if (txRow.status === 'paid') {
        res.json({ paid: true, transaction: txRow });
        return;
      }
      if (txRow.status === 'refunded' || txRow.status === 'failed') {
        res.status(400).json({ paid: false, status: txRow.status, error: `Transaction is ${txRow.status}.` });
        return;
      }

      if (txRow.gateway === 'paynow') {
        if (!txRow.pollUrl) {
          res.status(400).json({ paid: false, error: 'Missing Paynow poll reference.' });
          return;
        }
        const poll = await pollPaynowStatus(txRow.pollUrl);
        const status = (poll.status ?? '').trim().toLowerCase();
        const paidAmt = Number(poll.amount ?? 0);

        if (status === 'paid' && paidAmt >= txRow.amountUsd - 0.01) {
          const fulfilled = await fulfillPaidTransaction({
            transactionId: txRow.id,
            gatewayReference: poll.paynowreference || txRow.gatewayReference,
          });
          res.json({ paid: true, transaction: fulfilled.transaction });
          return;
        }
        if (['cancelled', 'failed', 'disputed'].includes(status)) {
          await db
            .update(paymentTransactions)
            .set({
              status: 'failed',
              gatewayReference: poll.paynowreference || txRow.gatewayReference,
              updatedAt: new Date(),
            })
            .where(and(eq(paymentTransactions.id, txRow.id), eq(paymentTransactions.status, 'pending')));
          res.json({
            paid: false,
            status: 'failed',
            gatewayStatus: poll.status,
          });
          return;
        }
        res.json({
          paid: false,
          status: txRow.status,
          gatewayStatus: poll.status || 'Awaiting payment',
        });
        return;
      }

      if (txRow.gateway === 'paypal') {
        const orderId = paypalOrderId || txRow.gatewayReference;
        if (!orderId) {
          res.status(400).json({ paid: false, error: 'Missing PayPal order ID.' });
          return;
        }
        const captured = await captureAndVerifyPayPalOrder({
          orderId,
          expectedAmountUsd: txRow.amountUsd,
        });
        const fulfilled = await fulfillPaidTransaction({
          transactionId: txRow.id,
          gatewayReference: orderId,
          gatewayCaptureId: captured.captureId,
        });
        res.json({ paid: true, transaction: fulfilled.transaction });
        return;
      }

      res.json({
        paid: false,
        status: txRow.status,
        message: 'Manual payment reference is awaiting administrator verification.',
      });
    } catch (err) {
      console.error('Payment verify error:', err);
      res.status(400).json({
        paid: false,
        error: err instanceof Error ? err.message : 'Payment verification failed.',
      });
    }
  });

  // ============================================================================
  // Admin Dating Management Routes
  // ============================================================================
  app.get('/api/admin/dating/overview', requireAdminPerm('manage_dating'), async (req, res) => {
    try {
      await ensureSeeded();
      await expireStaleDatingSubscriptions();

      const q = cleanText(req.query.q, 100).toLowerCase();
      const genderFilter = cleanText(req.query.gender, 20);
      const countryFilter = cleanText(req.query.country, 60).toLowerCase();
      const cityFilter = cleanText(req.query.city, 60).toLowerCase();
      const approvalFilter = cleanText(req.query.approvalStatus, 30);

      const [
        profileRows,
        packages,
        subscriptionsRows,
        selectionRows,
        datingReports,
        datingEnabled,
        datingRequireApproval,
        datingAllowHivDisclosure,
      ] = await Promise.all([
        db
          .select({
            profile: datingProfiles,
            userEmail: users.email,
            userFullName: users.fullName,
            verificationStatus: users.verificationStatus,
            accountStatus: users.accountStatus,
          })
          .from(datingProfiles)
          .innerJoin(users, eq(datingProfiles.userId, users.id))
          .orderBy(desc(datingProfiles.createdAt))
          .limit(300),
        db.select().from(datingPackages).orderBy(datingPackages.priceUsd),
        db
          .select({
            sub: datingSubscriptions,
            userName: users.fullName,
            userEmail: users.email,
          })
          .from(datingSubscriptions)
          .innerJoin(users, eq(datingSubscriptions.userId, users.id))
          .orderBy(desc(datingSubscriptions.createdAt))
          .limit(200),
        db
          .select({
            selection: datingSelections,
            chooserName: users.fullName,
            targetName: datingProfiles.displayName,
            targetCity: datingProfiles.city,
          })
          .from(datingSelections)
          .innerJoin(users, eq(datingSelections.userId, users.id))
          .innerJoin(datingProfiles, eq(datingSelections.targetProfileId, datingProfiles.id))
          .orderBy(desc(datingSelections.createdAt))
          .limit(150),
        db
          .select()
          .from(reports)
          .where(eq(reports.listingType, 'dating'))
          .orderBy(desc(reports.createdAt))
          .limit(100),
        getSetting('dating_enabled', 'true'),
        getSetting('dating_require_approval', 'true'),
        getSetting('dating_allow_hiv_disclosure', 'true'),
      ]);

      const filteredProfiles = profileRows
        .map((r) => ({
          ...r.profile,
          userEmail: r.userEmail,
          userFullName: r.userFullName,
          verificationStatus: r.verificationStatus,
          accountStatus: r.accountStatus,
        }))
        .filter((p) => {
          if (genderFilter && genderFilter !== 'all' && p.gender !== genderFilter) return false;
          if (approvalFilter && approvalFilter !== 'all' && p.approvalStatus !== approvalFilter) return false;
          if (countryFilter && !p.country.toLowerCase().includes(countryFilter)) return false;
          if (cityFilter && !p.city.toLowerCase().includes(cityFilter) && !p.suburb.toLowerCase().includes(cityFilter)) {
            return false;
          }
          if (q) {
            return `${p.displayName} ${p.userFullName} ${p.city} ${p.suburb} ${p.country} ${p.whatsapp}`
              .toLowerCase()
              .includes(q);
          }
          return true;
        });

      const activeSubsCount = subscriptionsRows.filter((s) => s.sub.status === 'active').length;
      const expiredSubsCount = subscriptionsRows.filter((s) => s.sub.status !== 'active').length;

      res.json({
        summary: {
          totalMembers: profileRows.length,
          pendingApproval: profileRows.filter((r) => r.profile.approvalStatus === 'pending').length,
          maleCount: profileRows.filter((r) => r.profile.gender === 'male').length,
          femaleCount: profileRows.filter((r) => r.profile.gender === 'female').length,
          activeSubscriptions: activeSubsCount,
          expiredSubscriptions: expiredSubsCount,
          totalSelections: selectionRows.length,
          openDatingReports: datingReports.filter((r) => r.status === 'open').length,
        },
        profiles: filteredProfiles,
        packages,
        subscriptions: subscriptionsRows.map((s) => ({
          ...s.sub,
          userName: s.userName,
          userEmail: s.userEmail,
        })),
        selections: selectionRows.map((s) => ({
          id: s.selection.id,
          chooserName: s.chooserName,
          targetName: s.targetName,
          targetCity: s.targetCity,
          createdAt: s.selection.createdAt,
        })),
        reports: datingReports,
        settings: {
          datingEnabled: datingEnabled === 'true',
          datingRequireApproval: datingRequireApproval === 'true',
          datingAllowHivDisclosure: datingAllowHivDisclosure === 'true',
        },
      });
    } catch (err) {
      console.error('Admin dating overview error:', err);
      res.status(500).json({ error: 'Failed to load dating management console.' });
    }
  });

  app.patch('/api/admin/dating/profiles/:id/moderate', requireAdminPerm('manage_dating'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid profile ID.' });
        return;
      }
      const decision = req.body?.decision === 'approve' ? 'approved' : req.body?.decision === 'reject' ? 'rejected' : null;
      const reason = cleanText(req.body?.reason, 300) || null;

      if (!decision) {
        res.status(400).json({ error: 'Specify decision "approve" or "reject".' });
        return;
      }

      const [updated] = await db
        .update(datingProfiles)
        .set({ approvalStatus: decision, moderationReason: reason, updatedAt: new Date() })
        .where(eq(datingProfiles.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Dating profile not found.' });
        return;
      }

      await notifyUser({
        userId: updated.userId,
        title: decision === 'approved' ? 'Dating Profile Approved' : 'Dating Profile Rejected',
        message:
          decision === 'approved'
            ? `Your Singles profile "${updated.displayName}" is now visible to eligible members.`
            : `Your Singles profile was not approved.${reason ? ` Reason: ${reason}` : ''}`,
        category: 'dating',
      });

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: `dating_profile_${decision}`,
        targetType: 'dating',
        targetId: String(id),
        summary: `${admin.fullName} ${decision} dating profile "${updated.displayName}"`,
      });

      res.json({ profile: updated });
    } catch {
      res.status(500).json({ error: 'Failed to moderate dating profile.' });
    }
  });

  app.patch('/api/admin/dating/profiles/:id/status', requireAdminPerm('manage_dating'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid profile ID.' });
        return;
      }
      const isSuspended = typeof req.body?.isSuspended === 'boolean' ? req.body.isSuspended : undefined;
      const isVisible = typeof req.body?.isVisible === 'boolean' ? req.body.isVisible : undefined;

      const [updated] = await db
        .update(datingProfiles)
        .set({
          ...(isSuspended !== undefined ? { isSuspended } : {}),
          ...(isVisible !== undefined ? { isVisible } : {}),
          updatedAt: new Date(),
        })
        .where(eq(datingProfiles.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Dating profile not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'dating_profile_status_updated',
        targetType: 'dating',
        targetId: String(id),
        summary: `${admin.fullName} updated dating status for "${updated.displayName}" (suspended=${updated.isSuspended}, visible=${updated.isVisible})`,
      });

      res.json({ profile: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update dating profile status.' });
    }
  });

  app.delete('/api/admin/dating/profiles/:id', requireAdminPerm('manage_dating'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid profile ID.' });
        return;
      }
      const [deleted] = await db.delete(datingProfiles).where(eq(datingProfiles.id, id)).returning();
      if (!deleted) {
        res.status(404).json({ error: 'Dating profile not found.' });
        return;
      }
      await db
        .update(users)
        .set({ datingOptIn: 'no', updatedAt: new Date() })
        .where(eq(users.id, deleted.userId));
      await db
        .update(reports)
        .set({ status: 'resolved', resolutionNote: 'Dating profile removed by moderator' })
        .where(and(eq(reports.listingType, 'dating'), eq(reports.listingId, id)));

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'dating_profile_deleted',
        targetType: 'dating',
        targetId: String(id),
        summary: `${admin.fullName} deleted dating profile "${deleted.displayName}"`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete dating profile.' });
    }
  });

  app.put('/api/admin/dating/packages/:id', requireAdminPerm('manage_dating'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid package ID.' });
        return;
      }
      const name = cleanText(req.body?.name, 80);
      const priceUsd = Number(req.body?.priceUsd);
      const maxSelections =
        req.body?.maxSelections === null ? null : req.body?.maxSelections !== undefined ? Number(req.body.maxSelections) : undefined;
      const durationDays =
        req.body?.durationDays === null ? null : req.body?.durationDays !== undefined ? Number(req.body.durationDays) : undefined;
      const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;

      const [updated] = await db
        .update(datingPackages)
        .set({
          ...(name ? { name } : {}),
          ...(Number.isFinite(priceUsd) && priceUsd > 0 ? { priceUsd } : {}),
          ...(maxSelections !== undefined ? { maxSelections } : {}),
          ...(durationDays !== undefined ? { durationDays } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        })
        .where(eq(datingPackages.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Dating package not found.' });
        return;
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'dating_package_updated',
        targetType: 'dating_package',
        targetId: String(id),
        summary: `${admin.fullName} updated dating package "${updated.name}" ($${updated.priceUsd})`,
      });
      res.json({ package: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update dating package.' });
    }
  });

  app.put('/api/admin/dating/settings', requireAdminPerm('manage_dating'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const entries: Array<[string, string]> = [];
      if (typeof req.body?.datingEnabled === 'boolean') {
        entries.push(['dating_enabled', String(req.body.datingEnabled)]);
      }
      if (typeof req.body?.datingRequireApproval === 'boolean') {
        entries.push(['dating_require_approval', String(req.body.datingRequireApproval)]);
      }
      if (typeof req.body?.datingAllowHivDisclosure === 'boolean') {
        entries.push(['dating_allow_hiv_disclosure', String(req.body.datingAllowHivDisclosure)]);
      }

      for (const [key, value] of entries) {
        await db
          .insert(platformSettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value, updatedAt: new Date() },
          });
      }

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'dating_settings_updated',
        summary: `${admin.fullName} updated dating visibility/privacy settings`,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to save dating settings.' });
    }
  });

  // ============================================================================
  // Admin Central Payment System Console Routes
  // ============================================================================
  app.get('/api/admin/transactions', requireAdminPerm('manage_payments'), async (req, res) => {
    try {
      const q = cleanText(req.query.q, 100).toLowerCase();
      const featureFilter = cleanText(req.query.featureType, 30);
      const gatewayFilter = cleanText(req.query.gateway, 20);
      const statusFilter = cleanText(req.query.status, 20);

      const rows = await db
        .select({
          tx: paymentTransactions,
          userName: users.fullName,
          userEmail: users.email,
          userPhone: users.whatsapp,
        })
        .from(paymentTransactions)
        .innerJoin(users, eq(paymentTransactions.userId, users.id))
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(400);

      const allMapped = rows.map((r) => ({
        ...r.tx,
        userName: r.userName,
        userEmail: r.userEmail,
        userPhone: r.userPhone,
      }));

      const paidRows = allMapped.filter((t) => t.status === 'paid');
      const sumFeature = (f: string) =>
        paidRows.filter((t) => t.featureType === f).reduce((acc, t) => acc + t.amountUsd, 0);
      const sumGateway = (g: string) =>
        paidRows.filter((t) => t.gateway === g).reduce((acc, t) => acc + t.amountUsd, 0);

      const filtered = allMapped.filter((t) => {
        if (featureFilter && featureFilter !== 'all' && t.featureType !== featureFilter) return false;
        if (gatewayFilter && gatewayFilter !== 'all' && t.gateway !== gatewayFilter) return false;
        if (statusFilter && statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (q) {
          return `${t.merchantReference} ${t.gatewayReference || ''} ${t.targetTitle} ${t.userName} ${t.userEmail}`
            .toLowerCase()
            .includes(q);
        }
        return true;
      });

      res.json({
        capabilities: getGatewayCapabilities(),
        summary: {
          totalRevenueUsd: paidRows.reduce((acc, t) => acc + t.amountUsd, 0),
          refundedRevenueUsd: allMapped
            .filter((t) => t.status === 'refunded')
            .reduce((acc, t) => acc + (t.refundedAmountUsd ?? t.amountUsd), 0),
          pendingCount: allMapped.filter((t) => t.status === 'pending').length,
          paidCount: paidRows.length,
          failedCount: allMapped.filter((t) => t.status === 'failed').length,
          refundedCount: allMapped.filter((t) => t.status === 'refunded').length,
          revenueByFeature: {
            dating_package: sumFeature('dating_package'),
            sponsored_job: sumFeature('sponsored_job'),
            sponsored_market: sumFeature('sponsored_market'),
            sponsored_house: sumFeature('sponsored_house'),
          },
          revenueByGateway: {
            paynow: sumGateway('paynow'),
            paypal: sumGateway('paypal'),
            manual: sumGateway('manual'),
          },
        },
        transactions: filtered,
      });
    } catch (err) {
      console.error('Admin transactions error:', err);
      res.status(500).json({ error: 'Failed to load central payment transactions.' });
    }
  });

  app.patch('/api/admin/transactions/:id/confirm', requireAdminPerm('manage_payments'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid transaction ID.' });
        return;
      }
      const adminNote = cleanText(req.body?.adminNote, 300) || null;
      const result = await fulfillPaidTransaction({
        transactionId: id,
        adminId: admin.id,
        adminName: admin.fullName,
        adminNote,
      });
      res.json({ transaction: result.transaction });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not confirm payment.' });
    }
  });

  app.patch('/api/admin/transactions/:id/fail', requireAdminPerm('manage_payments'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid transaction ID.' });
        return;
      }
      const adminNote = cleanText(req.body?.adminNote, 300) || 'Payment reference rejected by administrator.';

      const [updated] = await db
        .update(paymentTransactions)
        .set({
          status: 'failed',
          adminNote,
          confirmedByAdminId: admin.id,
          updatedAt: new Date(),
        })
        .where(and(eq(paymentTransactions.id, id), eq(paymentTransactions.status, 'pending')))
        .returning();

      if (!updated) {
        res.status(400).json({ error: 'Pending transaction not found.' });
        return;
      }

      const legacyId = Number(updated.metadataJson?.legacySponsorshipPaymentId || 0);
      if (legacyId > 0) {
        await db
          .update(sponsorshipPayments)
          .set({ status: 'rejected', adminNote, confirmedByAdminId: admin.id })
          .where(eq(sponsorshipPayments.id, legacyId));
      }

      await notifyUser({
        userId: updated.userId,
        title: 'Payment Not Confirmed',
        message: `Your payment (${updated.merchantReference}) for "${updated.targetTitle}" was rejected: ${adminNote}`,
        category: 'payment',
      });

      await logAudit({
        actorType: 'admin',
        actorId: String(admin.id),
        actorName: admin.fullName,
        action: 'central_payment_rejected',
        targetType: updated.featureType,
        targetId: String(id),
        summary: `${admin.fullName} rejected payment ${updated.merchantReference} (${adminNote})`,
      });

      res.json({ transaction: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update transaction.' });
    }
  });

  app.post('/api/admin/transactions/:id/refund', requireAdminPerm('manage_payments'), async (req: AuthedAdminRequest, res) => {
    try {
      const admin = req.currentAdmin!;
      const id = parsePositiveId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'Invalid transaction ID.' });
        return;
      }
      const reason = cleanText(req.body?.reason, 300) || 'Refund issued by administrator.';
      const updated = await refundCentralTransaction({
        transactionId: id,
        adminId: admin.id,
        adminName: admin.fullName,
        reason,
      });
      res.json({ transaction: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Refund failed.' });
    }
  });
}
