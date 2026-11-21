import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
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
  platformSettings,
  reports,
  sponsorshipPayments,
  sponsorshipPlans,
  users,
} from '../src/db/schema.ts';
import { hashPassword } from './auth.ts';

export const ALL_PERMISSIONS = [
  'manage_users',
  'verify_users',
  'moderate_ads',
  'manage_dating',
  'manage_sponsorships',
  'manage_payments',
  'manage_reports',
  'manage_categories',
  'manage_admins',
  'view_logs',
  'manage_settings',
] as const;

export type AdminPermission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, AdminPermission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  moderator: ['moderate_ads', 'manage_reports', 'manage_dating'],
  user_manager: ['manage_users', 'verify_users'],
  sponsorship_manager: ['manage_sponsorships', 'manage_payments'],
};

export const DEFAULT_EXPIRY_DAYS = 30;

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runInitialSeed().catch((err) => {
      seedPromise = null;
      console.error('Seed failed:', err);
      throw new Error('Failed to initialize default marketplace data.', { cause: err });
    });
  }
  await seedPromise;
}

async function runInitialSeed(): Promise<void> {
  // 1. Seed categories if empty
  const existingCats = await db.select({ value: count() }).from(categories);
  if ((existingCats[0]?.value ?? 0) === 0) {
    const jobCats = [
      'Sales & Retail',
      'Trades & Artisans',
      'Admin & Office',
      'Driving & Logistics',
      'Tech & IT',
      'Hospitality & Catering',
      'Construction & Engineering',
      'Agriculture',
      'Healthcare & Education',
      'Domestic & Care',
    ];
    const marketCats = [
      'Electronics & Solar',
      'Phones & Computers',
      'Vehicles & Spares',
      'Services & Repairs',
      'Home & Furniture',
      'Farm & Produce',
      'Fashion & Beauty',
      'Building Materials',
      'Other',
    ];
    const houseCats = ['House', 'Room', 'Flat', 'Apartment', 'Cottage', 'Commercial'];

    await db.insert(categories).values([
      ...jobCats.map((name, idx) => ({ section: 'job', name, isActive: true, sortOrder: idx })),
      ...marketCats.map((name, idx) => ({ section: 'market', name, isActive: true, sortOrder: idx })),
      ...houseCats.map((name, idx) => ({ section: 'house', name, isActive: true, sortOrder: idx })),
    ]);
  }

  // 2. Seed sponsorship plans if empty
  const existingPlans = await db.select({ value: count() }).from(sponsorshipPlans);
  if ((existingPlans[0]?.value ?? 0) === 0) {
    await db.insert(sponsorshipPlans).values([
      { name: '7-Day Boost', durationDays: 7, priceUsd: 5, isActive: true },
      { name: '14-Day Boost', durationDays: 14, priceUsd: 9, isActive: true },
      { name: '30-Day Boost', durationDays: 30, priceUsd: 15, isActive: true },
    ]);
  }

  // 2b. Seed dating packages if empty
  const existingDatingPkgs = await db.select({ value: count() }).from(datingPackages);
  if ((existingDatingPkgs[0]?.value ?? 0) === 0) {
    await db.insert(datingPackages).values([
      {
        slug: 'starter_3',
        name: 'Starter Connect (1–3 Singles)',
        priceUsd: 6,
        minSelections: 1,
        maxSelections: 3,
        durationDays: null,
        isUnlimited: false,
        description: 'Choose and connect on WhatsApp with 1 to 3 verified singles.',
        isActive: true,
      },
      {
        slug: 'standard_15',
        name: 'Standard Connect (4–15 Singles)',
        priceUsd: 10,
        minSelections: 4,
        maxSelections: 15,
        durationDays: null,
        isUnlimited: false,
        description: 'Choose and connect on WhatsApp with up to 15 eligible singles.',
        isActive: true,
      },
      {
        slug: 'unlimited_30d',
        name: 'Unlimited 30-Day Pass',
        priceUsd: 20,
        minSelections: 1,
        maxSelections: null,
        durationDays: 30,
        isUnlimited: true,
        description: 'Unlimited access to all eligible singles for 30 days.',
        isActive: true,
      },
    ]);
  }

  // 3. Seed platform settings
  await db
    .insert(platformSettings)
    .values([
      {
        key: 'payment_instructions',
        value:
          'Pay securely with Paynow Zimbabwe or PayPal, or use EcoCash / InnBucks / Bank Transfer reference below.',
      },
      {
        key: 'listing_expiry_days',
        value: '30',
      },
      {
        key: 'dating_enabled',
        value: 'true',
      },
      {
        key: 'dating_require_approval',
        value: 'true',
      },
      {
        key: 'dating_allow_hiv_disclosure',
        value: 'true',
      },
    ])
    .onConflictDoNothing();

  // 4. Optional env-configured Super Admin bootstrap (if env vars are provided & no super_admin exists yet)
  const envAdminPass = (process.env.ADMIN_PASSCODE ?? '').trim();
  const envAdminUser = (process.env.SUPER_ADMIN_USERNAME ?? 'superadmin').trim().toLowerCase() || 'superadmin';
  if (envAdminPass.length >= 6) {
    const existingSuper = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.role, 'super_admin'))
      .limit(1);
    if (existingSuper.length === 0) {
      await db
        .insert(admins)
        .values({
          username: envAdminUser,
          fullName: 'Super Administrator',
          passwordHash: hashPassword(envAdminPass),
          role: 'super_admin',
          permissions: [...ALL_PERMISSIONS],
          isActive: true,
        })
        .onConflictDoNothing();
    }
  }

  // 5. Seed initial sample listings if all 3 tables are empty
  const [jCount, mCount, hCount] = await Promise.all([
    db.select({ value: count() }).from(jobs),
    db.select({ value: count() }).from(marketItems),
    db.select({ value: count() }).from(houses),
  ]);

  const now = Date.now();
  const hour = 3600 * 1000;
  const expiresAt = new Date(now + 1000 * 60 * 60 * 24 * DEFAULT_EXPIRY_DAYS);
  const sponsoredUntil = new Date(now + 1000 * 60 * 60 * 24 * 14);

  if ((jCount[0]?.value ?? 0) === 0 && (mCount[0]?.value ?? 0) === 0 && (hCount[0]?.value ?? 0) === 0) {
    const [seedUser] = await db
      .insert(users)
      .values({
        uid: 'community-seed-zim',
        email: 'listings@marketjobs.co.zw',
        fullName: 'Kudakwashe Moyo',
        phone: '+263772410885',
        whatsapp: '+263772410885',
        city: 'Harare',
        verificationStatus: 'verified',
        accountStatus: 'active',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { fullName: 'Kudakwashe Moyo' },
      })
      .returning();

    await db.insert(jobs).values([
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'SunGrid Zimbabwe',
        title: 'Solar Technician & Installer',
        employer: 'SunGrid Zimbabwe',
        description:
          'Install and maintain hybrid 3kVA-10kVA residential solar systems across Harare suburbs. Full-time field role with transport provided.',
        requirements:
          '2+ years hands-on inverter and lithium battery installation experience, clean Class 4 driver licence preferred.',
        salary: 'USD 650/month',
        employmentType: 'Full-time',
        category: 'Trades & Artisans',
        location: 'Harare',
        whatsapp: '+263772410885',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: true,
        sponsoredUntil,
        expiresAt,
        createdAt: new Date(now - hour * 2),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Highland Hardware',
        title: 'Retail Sales Supervisor',
        employer: 'Highland Hardware',
        description:
          'Oversee daily counter sales, stock counts, and customer service at our Bulawayo CBD hardware branch.',
        requirements:
          '5 O-Levels including English and Maths, 3 years retail supervisory experience, honest and well-spoken.',
        salary: 'USD 480/month',
        employmentType: 'Full-time',
        category: 'Sales & Retail',
        location: 'Bulawayo',
        whatsapp: '+263719334210',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 5),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Eastern Highlands Logistics',
        title: 'Class 2 Delivery Driver',
        employer: 'Eastern Highlands Logistics',
        description:
          'Mutare to Harare weekly freight deliveries. Well-maintained 8-tonne truck, overnight allowances paid.',
        requirements:
          'Valid Class 2 licence, Defensive Driving Certificate, medical certificate, traceable references.',
        salary: 'USD 550 + allowances',
        employmentType: 'Contract',
        category: 'Driving & Logistics',
        location: 'Mutare',
        whatsapp: '+263774889120',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 11),
      },
    ]);

    await db.insert(marketItems).values([
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Tafadzwa Ndlovu',
        title: '5kVA Hybrid Solar Inverter + 5kWh Lithium Battery',
        price: 1450,
        currency: 'USD',
        description:
          'Brand new 5kVA pure sine wave hybrid inverter paired with 5kWh LiFePO4 battery pack. 2-year warranty, installation available in Harare & Chitungwiza.',
        category: 'Electronics & Solar',
        location: 'Harare',
        photos: ['/src/assets/images/market_solar_kit_1795256609472.jpg'],
        whatsapp: '+263773512904',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: true,
        sponsoredUntil,
        expiresAt,
        createdAt: new Date(now - hour * 1),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Rumbidzai Gono',
        title: 'Core i5 Business Laptop (16GB RAM / 512GB SSD)',
        price: 340,
        currency: 'USD',
        description:
          'Clean silver ultrabook in great condition, strong 6-hour battery, backlit keyboard, charger included. Ready for work or varsity.',
        category: 'Phones & Computers',
        location: 'Bulawayo',
        photos: ['/src/assets/images/market_laptop_desk_1795256608982.jpg'],
        whatsapp: '+263782904112',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 4),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Farai Makoni',
        title: 'Fresh Farm Tomatoes & Green Peppers (Wholesale Crates)',
        price: 18,
        currency: 'USD',
        description:
          'Grade A fresh tomatoes and crisp green peppers harvested daily from our Marondera farm. Delivery to Mbare or direct collection.',
        category: 'Farm & Produce',
        location: 'Marondera',
        photos: ['/src/assets/images/market_farm_produce_1795256608260.jpg'],
        whatsapp: '+263775618230',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 9),
      },
    ]);

    await db.insert(houses).values([
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Mrs Chipo Nyathi',
        propertyType: 'Cottage',
        title: 'Neat 2-Bedroom Garden Cottage',
        suburb: 'Avondale',
        city: 'Harare',
        price: 450,
        bedrooms: 2,
        description:
          'Quiet, self-contained 2-bedroom brick cottage in a leafy Avondale yard. Features a fitted kitchen, bright lounge, paved parking, reliable borehole water, and solar backup.',
        facilities: ['Borehole Water', 'Solar Backup', 'Walled & Gated', 'Parking Space'],
        photos: ['/src/assets/images/house_harare_cottage_1795256608629.jpg'],
        whatsapp: '+263772819440',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: true,
        sponsoredUntil,
        expiresAt,
        createdAt: new Date(now - hour * 3),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Bongani Dube',
        propertyType: 'Apartment',
        title: 'Modern 2-Bedroom Sunny Apartment',
        suburb: 'Suburbs',
        city: 'Bulawayo',
        price: 380,
        bedrooms: 2,
        description:
          'Spacious modern apartment with porcelain tiled floors, open-plan fitted kitchen, and large sunlit windows. Secure complex close to shops and schools.',
        facilities: ['Prepaid ZESA', 'Fitted Kitchen', 'Parking Space', 'Walled & Gated'],
        photos: ['/src/assets/images/house_flat_interior_1795256609336.jpg'],
        whatsapp: '+263712667891',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 6),
      },
      {
        userId: seedUser.id,
        authorUid: seedUser.uid,
        authorName: 'Tatenda Zvobgo',
        propertyType: 'Room',
        title: 'Clean Single Room with Separate Entrance',
        suburb: 'Kuwadzana Phase 3',
        city: 'Harare',
        price: 95,
        bedrooms: 1,
        description:
          'Tiled single room suitable for a working professional or couple. Own prepaid ZESA sub-meter, borehole water on site, walled and gated yard.',
        facilities: ['Borehole Water', 'Prepaid ZESA', 'Walled & Gated'],
        photos: [],
        whatsapp: '+263778102394',
        approvalStatus: 'approved',
        lifecycleStatus: 'active',
        isSponsored: false,
        expiresAt,
        createdAt: new Date(now - hour * 12),
      },
    ]);
  }

  // 6. Seed sample Zimbabwe singles profiles if empty
  const existingSingles = await db.select({ value: count() }).from(datingProfiles);
  if ((existingSingles[0]?.value ?? 0) === 0) {
    const sampleAccounts = [
      {
        uid: 'seed-single-f1',
        email: 'rutendo.singles@marketjobs.co.zw',
        fullName: 'Rutendo M.',
        phone: '+263773104821',
        whatsapp: '+263773104821',
        city: 'Harare',
        datingOptIn: 'yes',
        verificationStatus: 'verified',
        accountStatus: 'active',
      },
      {
        uid: 'seed-single-m1',
        email: 'tatenda.singles@marketjobs.co.zw',
        fullName: 'Tatenda K.',
        phone: '+263774219305',
        whatsapp: '+263774219305',
        city: 'Harare',
        datingOptIn: 'yes',
        verificationStatus: 'verified',
        accountStatus: 'active',
      },
      {
        uid: 'seed-single-f2',
        email: 'nomsa.singles@marketjobs.co.zw',
        fullName: 'Nomsa N.',
        phone: '+263719842110',
        whatsapp: '+263719842110',
        city: 'Bulawayo',
        datingOptIn: 'yes',
        verificationStatus: 'verified',
        accountStatus: 'active',
      },
      {
        uid: 'seed-single-m2',
        email: 'farai.singles@marketjobs.co.zw',
        fullName: 'Farai M.',
        phone: '+263782550192',
        whatsapp: '+263782550192',
        city: 'Bulawayo',
        datingOptIn: 'yes',
        verificationStatus: 'unverified',
        accountStatus: 'active',
      },
    ];

    for (const acc of sampleAccounts) {
      await db.insert(users).values(acc).onConflictDoNothing();
    }

    const seededUsers = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.uid, 'seed-single-f1'),
          eq(users.uid, 'seed-single-m1'),
          eq(users.uid, 'seed-single-f2'),
          eq(users.uid, 'seed-single-m2')
        )
      );

    const byUid = new Map<string, typeof users.$inferSelect>(seededUsers.map((u) => [u.uid, u]));
    const f1 = byUid.get('seed-single-f1');
    const m1 = byUid.get('seed-single-m1');
    const f2 = byUid.get('seed-single-f2');
    const m2 = byUid.get('seed-single-m2');

    const profilesToInsert = [
      f1 && {
        userId: f1.id,
        displayName: 'Rutendo',
        age: 28,
        gender: 'female',
        country: 'Zimbabwe',
        city: 'Harare',
        suburb: 'Avondale',
        whatsapp: f1.whatsapp,
        photo: '/src/assets/images/single_woman_harare_1795273489530.jpg',
        childrenCount: 0,
        hivStatus: 'Negative',
        shareHivWithSubscribers: true,
        description:
          'Warmhearted accountant in Harare who loves Sunday church, baking, and quiet family time. Looking for a respectful partner ready for commitment.',
        intention: 'marriage',
        termsAccepted: true,
        approvalStatus: 'approved',
        isVisible: true,
        isSuspended: false,
      },
      m1 && {
        userId: m1.id,
        displayName: 'Tatenda',
        age: 31,
        gender: 'male',
        country: 'Zimbabwe',
        city: 'Harare',
        suburb: 'Mount Pleasant',
        whatsapp: m1.whatsapp,
        photo: '/src/assets/images/single_man_harare_1795273488592.jpg',
        childrenCount: 0,
        hivStatus: 'Negative',
        shareHivWithSubscribers: true,
        description:
          'Civil engineer based in Harare. Value honesty, kindness, and building a calm home together.',
        intention: 'serious_relationship',
        termsAccepted: true,
        approvalStatus: 'approved',
        isVisible: true,
        isSuspended: false,
      },
      f2 && {
        userId: f2.id,
        displayName: 'Nomsa',
        age: 30,
        gender: 'female',
        country: 'Zimbabwe',
        city: 'Bulawayo',
        suburb: 'Suburbs',
        whatsapp: f2.whatsapp,
        photo: '/src/assets/images/single_woman_bulawayo_1795273489230.jpg',
        childrenCount: 1,
        hivStatus: 'Prefer not to disclose',
        shareHivWithSubscribers: false,
        description:
          'Boutique entrepreneur in Bulawayo. Family-focused, optimistic, and hoping to meet a genuine gentleman for a serious relationship.',
        intention: 'serious_relationship',
        termsAccepted: true,
        approvalStatus: 'approved',
        isVisible: true,
        isSuspended: false,
      },
      m2 && {
        userId: m2.id,
        displayName: 'Farai',
        age: 34,
        gender: 'male',
        country: 'Zimbabwe',
        city: 'Bulawayo',
        suburb: 'Hillside',
        whatsapp: m2.whatsapp,
        photo: '/src/assets/images/single_man_bulawayo_1795273488623.jpg',
        childrenCount: 1,
        hivStatus: 'Prefer not to disclose',
        shareHivWithSubscribers: false,
        description:
          'Logistics coordinator in Hillside. Enjoy outdoor braais, reading, and thoughtful conversation.',
        intention: 'marriage',
        termsAccepted: true,
        approvalStatus: 'approved',
        isVisible: true,
        isSuspended: false,
      },
    ].filter((p): p is NonNullable<typeof p> => Boolean(p));

    if (profilesToInsert.length > 0) {
      await db.insert(datingProfiles).values(profilesToInsert).onConflictDoNothing();
    }
  }
}

export async function expireStaleSponsorships(): Promise<void> {
  const now = new Date();
  try {
    await Promise.all([
      db
        .update(jobs)
        .set({ isSponsored: false })
        .where(and(eq(jobs.isSponsored, true), lte(jobs.sponsoredUntil, now))),
      db
        .update(marketItems)
        .set({ isSponsored: false })
        .where(and(eq(marketItems.isSponsored, true), lte(marketItems.sponsoredUntil, now))),
      db
        .update(houses)
        .set({ isSponsored: false })
        .where(and(eq(houses.isSponsored, true), lte(houses.sponsoredUntil, now))),
      db
        .update(sponsorshipPayments)
        .set({ status: 'expired' })
        .where(and(eq(sponsorshipPayments.status, 'confirmed'), lte(sponsorshipPayments.expiresAt, now))),
    ]);
  } catch (error) {
    console.error('Failed to expire stale sponsorships:', error);
  }
}

export async function expireStaleDatingSubscriptions(): Promise<void> {
  const now = new Date();
  try {
    await db
      .update(datingSubscriptions)
      .set({ status: 'expired' })
      .where(
        and(
          eq(datingSubscriptions.status, 'active'),
          sql`${datingSubscriptions.expiresAt} IS NOT NULL`,
          lte(datingSubscriptions.expiresAt, now)
        )
      );
  } catch (error) {
    console.error('Failed to expire dating subscriptions:', error);
  }
}

export async function getActiveDatingSubscription(userId: number) {
  await expireStaleDatingSubscriptions();
  const [sub] = await db
    .select()
    .from(datingSubscriptions)
    .where(and(eq(datingSubscriptions.userId, userId), eq(datingSubscriptions.status, 'active')))
    .orderBy(desc(datingSubscriptions.createdAt))
    .limit(1);

  if (!sub) return null;
  if (!sub.isUnlimited && sub.selectionLimit !== null && sub.selectionsUsed >= sub.selectionLimit) {
    await db
      .update(datingSubscriptions)
      .set({ status: 'exhausted' })
      .where(eq(datingSubscriptions.id, sub.id));
    return null;
  }
  return sub;
}

export async function logAudit(params: {
  actorType: 'user' | 'admin' | 'system';
  actorId?: string | null;
  actorName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      summary: params.summary,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function notifyUser(params: {
  userId: number;
  title: string;
  message: string;
  category: 'approval' | 'verification' | 'sponsorship' | 'account' | 'dating' | 'payment';
}): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId: params.userId,
      title: params.title,
      message: params.message,
      category: params.category,
    });
  } catch (error) {
    console.error('Failed to write notification:', error);
  }
}

export async function upsertUserFromFirebase(params: {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string | null;
}) {
  try {
    const fallbackName = params.displayName?.trim() || params.email.split('@')[0] || 'Member';
    const [row] = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        fullName: fallbackName,
        avatar: params.photoUrl ?? null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Could not load user profile. Please try again.', { cause: error });
  }
}

export async function getPublicJobs(params: {
  q?: string;
  location?: string;
  category?: string;
  page: number;
  limit: number;
}) {
  try {
    await ensureSeeded();
    await expireStaleSponsorships();
    const now = new Date();

    const conditions = [
      eq(jobs.approvalStatus, 'approved'),
      or(eq(jobs.lifecycleStatus, 'active'), eq(jobs.lifecycleStatus, 'filled')),
      or(sql`${jobs.expiresAt} IS NULL`, gte(jobs.expiresAt, now)),
      or(sql`${users.accountStatus} IS NULL`, eq(users.accountStatus, 'active')),
    ];

    if (params.location && params.location !== 'All') {
      conditions.push(ilike(jobs.location, params.location));
    }
    if (params.category && params.category !== 'All') {
      conditions.push(eq(jobs.category, params.category));
    }
    if (params.q) {
      const pattern = `%${params.q}%`;
      conditions.push(
        or(
          ilike(jobs.title, pattern),
          ilike(jobs.employer, pattern),
          ilike(jobs.description, pattern),
          ilike(jobs.location, pattern)
        )!
      );
    }

    const whereClause = and(...conditions);
    const offset = (params.page - 1) * params.limit;

    const [totalRow, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(jobs)
        .leftJoin(users, eq(jobs.userId, users.id))
        .where(whereClause),
      db
        .select({
          job: jobs,
          authorVerified: users.verificationStatus,
        })
        .from(jobs)
        .leftJoin(users, eq(jobs.userId, users.id))
        .where(whereClause)
        .orderBy(desc(jobs.isSponsored), desc(jobs.createdAt))
        .limit(params.limit)
        .offset(offset),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      items: rows.map((r) => ({
        ...r.job,
        isVerified: r.authorVerified === 'verified',
      })),
      total,
      page: params.page,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  } catch (error) {
    console.error('Failed to query jobs:', error);
    throw new Error('Could not load jobs right now.', { cause: error });
  }
}

export async function getPublicMarketItems(params: {
  q?: string;
  location?: string;
  category?: string;
  page: number;
  limit: number;
}) {
  try {
    await ensureSeeded();
    await expireStaleSponsorships();
    const now = new Date();

    const conditions = [
      eq(marketItems.approvalStatus, 'approved'),
      or(eq(marketItems.lifecycleStatus, 'active'), eq(marketItems.lifecycleStatus, 'sold')),
      or(sql`${marketItems.expiresAt} IS NULL`, gte(marketItems.expiresAt, now)),
      or(sql`${users.accountStatus} IS NULL`, eq(users.accountStatus, 'active')),
    ];

    if (params.location && params.location !== 'All') {
      conditions.push(ilike(marketItems.location, params.location));
    }
    if (params.category && params.category !== 'All') {
      conditions.push(eq(marketItems.category, params.category));
    }
    if (params.q) {
      const pattern = `%${params.q}%`;
      conditions.push(
        or(
          ilike(marketItems.title, pattern),
          ilike(marketItems.description, pattern),
          ilike(marketItems.location, pattern),
          ilike(marketItems.category, pattern)
        )!
      );
    }

    const whereClause = and(...conditions);
    const offset = (params.page - 1) * params.limit;

    const [totalRow, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(marketItems)
        .leftJoin(users, eq(marketItems.userId, users.id))
        .where(whereClause),
      db
        .select({
          item: marketItems,
          authorVerified: users.verificationStatus,
        })
        .from(marketItems)
        .leftJoin(users, eq(marketItems.userId, users.id))
        .where(whereClause)
        .orderBy(desc(marketItems.isSponsored), desc(marketItems.createdAt))
        .limit(params.limit)
        .offset(offset),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      items: rows.map((r) => ({
        ...r.item,
        isVerified: r.authorVerified === 'verified',
      })),
      total,
      page: params.page,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  } catch (error) {
    console.error('Failed to query market items:', error);
    throw new Error('Could not load market listings right now.', { cause: error });
  }
}

export async function getPublicHouses(params: {
  q?: string;
  location?: string;
  propertyType?: string;
  page: number;
  limit: number;
}) {
  try {
    await ensureSeeded();
    await expireStaleSponsorships();
    const now = new Date();

    const conditions = [
      eq(houses.approvalStatus, 'approved'),
      or(eq(houses.lifecycleStatus, 'active'), eq(houses.lifecycleStatus, 'rented')),
      or(sql`${houses.expiresAt} IS NULL`, gte(houses.expiresAt, now)),
      or(sql`${users.accountStatus} IS NULL`, eq(users.accountStatus, 'active')),
    ];

    if (params.location && params.location !== 'All') {
      conditions.push(or(ilike(houses.city, params.location), ilike(houses.suburb, `%${params.location}%`))!);
    }
    if (params.propertyType && params.propertyType !== 'All') {
      conditions.push(eq(houses.propertyType, params.propertyType));
    }
    if (params.q) {
      const pattern = `%${params.q}%`;
      conditions.push(
        or(
          ilike(houses.title, pattern),
          ilike(houses.suburb, pattern),
          ilike(houses.city, pattern),
          ilike(houses.description, pattern)
        )!
      );
    }

    const whereClause = and(...conditions);
    const offset = (params.page - 1) * params.limit;

    const [totalRow, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(houses)
        .leftJoin(users, eq(houses.userId, users.id))
        .where(whereClause),
      db
        .select({
          house: houses,
          authorVerified: users.verificationStatus,
        })
        .from(houses)
        .leftJoin(users, eq(houses.userId, users.id))
        .where(whereClause)
        .orderBy(desc(houses.isSponsored), desc(houses.createdAt))
        .limit(params.limit)
        .offset(offset),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      items: rows.map((r) => ({
        ...r.house,
        isVerified: r.authorVerified === 'verified',
      })),
      total,
      page: params.page,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    };
  } catch (error) {
    console.error('Failed to query houses:', error);
    throw new Error('Could not load houses right now.', { cause: error });
  }
}
