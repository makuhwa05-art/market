import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  city: text('city').notNull().default('Harare'),
  avatar: text('avatar'),
  datingOptIn: text('dating_opt_in').notNull().default('unset'), // 'unset' | 'yes' | 'no'
  verificationStatus: text('verification_status').notNull().default('unverified'),
  verificationNote: text('verification_note'),
  accountStatus: text('account_status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  section: text('section').notNull(), // 'job' | 'market' | 'house'
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  authorUid: text('author_uid').notNull(),
  authorName: text('author_name').notNull(),
  title: text('title').notNull(),
  employer: text('employer').notNull(),
  description: text('description').notNull(),
  requirements: text('requirements').notNull(),
  salary: text('salary'),
  employmentType: text('employment_type').notNull().default('Full-time'),
  category: text('category').notNull(),
  location: text('location').notNull(),
  whatsapp: text('whatsapp').notNull(),
  approvalStatus: text('approval_status').notNull().default('pending'),
  moderationReason: text('moderation_reason'),
  lifecycleStatus: text('lifecycle_status').notNull().default('active'),
  isSponsored: boolean('is_sponsored').notNull().default(false),
  sponsoredUntil: timestamp('sponsored_until'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const marketItems = pgTable('market_items', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  authorUid: text('author_uid').notNull(),
  authorName: text('author_name').notNull(),
  title: text('title').notNull(),
  price: doublePrecision('price').notNull(),
  currency: text('currency').notNull().default('USD'),
  description: text('description').notNull(),
  category: text('category').notNull(),
  location: text('location').notNull(),
  photos: jsonb('photos').$type<string[]>().notNull().default([]),
  whatsapp: text('whatsapp').notNull(),
  approvalStatus: text('approval_status').notNull().default('pending'),
  moderationReason: text('moderation_reason'),
  lifecycleStatus: text('lifecycle_status').notNull().default('active'),
  isSponsored: boolean('is_sponsored').notNull().default(false),
  sponsoredUntil: timestamp('sponsored_until'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const houses = pgTable('houses', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  authorUid: text('author_uid').notNull(),
  authorName: text('author_name').notNull(),
  propertyType: text('property_type').notNull(),
  title: text('title').notNull(),
  suburb: text('suburb').notNull(),
  city: text('city').notNull(),
  price: doublePrecision('price').notNull(),
  bedrooms: integer('bedrooms').notNull().default(1),
  description: text('description').notNull(),
  facilities: jsonb('facilities').$type<string[]>().notNull().default([]),
  photos: jsonb('photos').$type<string[]>().notNull().default([]),
  whatsapp: text('whatsapp').notNull(),
  approvalStatus: text('approval_status').notNull().default('pending'),
  moderationReason: text('moderation_reason'),
  lifecycleStatus: text('lifecycle_status').notNull().default('active'),
  isSponsored: boolean('is_sponsored').notNull().default(false),
  sponsoredUntil: timestamp('sponsored_until'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sponsorshipPlans = pgTable('sponsorship_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  durationDays: integer('duration_days').notNull(),
  priceUsd: doublePrecision('price_usd').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const sponsorshipPayments = pgTable('sponsorship_payments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  listingType: text('listing_type').notNull(), // 'job' | 'market' | 'house'
  listingId: integer('listing_id').notNull(),
  listingTitle: text('listing_title').notNull(),
  planId: integer('plan_id').references(() => sponsorshipPlans.id),
  durationDays: integer('duration_days').notNull(),
  amountUsd: doublePrecision('amount_usd').notNull(),
  paymentMethod: text('payment_method').notNull(),
  paymentReference: text('payment_reference').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'rejected' | 'expired'
  adminNote: text('admin_note'),
  confirmedByAdminId: integer('confirmed_by_admin_id'),
  startsAt: timestamp('starts_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const datingPackages = pgTable('dating_packages', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  priceUsd: doublePrecision('price_usd').notNull(),
  minSelections: integer('min_selections').notNull().default(1),
  maxSelections: integer('max_selections'), // null means unlimited
  durationDays: integer('duration_days'), // null means limit-based until used
  isUnlimited: boolean('is_unlimited').notNull().default(false),
  description: text('description').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const datingProfiles = pgTable('dating_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  displayName: text('display_name').notNull(),
  age: integer('age').notNull(),
  gender: text('gender').notNull(), // 'male' | 'female'
  country: text('country').notNull().default('Zimbabwe'),
  city: text('city').notNull(),
  suburb: text('suburb').notNull(),
  whatsapp: text('whatsapp').notNull(),
  photo: text('photo').notNull(),
  childrenCount: integer('children_count'),
  hivStatus: text('hiv_status').notNull().default('Prefer not to disclose'),
  shareHivWithSubscribers: boolean('share_hiv_with_subscribers').notNull().default(false),
  description: text('description').notNull(),
  intention: text('intention').notNull().default('serious_relationship'), // 'dating' | 'serious_relationship' | 'marriage'
  termsAccepted: boolean('terms_accepted').notNull().default(false),
  approvalStatus: text('approval_status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  moderationReason: text('moderation_reason'),
  isVisible: boolean('is_visible').notNull().default(true),
  isSuspended: boolean('is_suspended').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const paymentTransactions = pgTable('payment_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  featureType: text('feature_type').notNull(), // 'dating_package' | 'sponsored_job' | 'sponsored_market' | 'sponsored_house'
  targetId: integer('target_id').notNull(),
  targetTitle: text('target_title').notNull(),
  planOrPackageId: integer('plan_or_package_id'),
  gateway: text('gateway').notNull(), // 'paynow' | 'paypal' | 'manual'
  amountUsd: doublePrecision('amount_usd').notNull(),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('pending'), // 'pending' | 'paid' | 'failed' | 'refunded'
  merchantReference: text('merchant_reference').notNull().unique(),
  gatewayReference: text('gateway_reference'),
  gatewayCaptureId: text('gateway_capture_id'),
  pollUrl: text('poll_url'),
  checkoutUrl: text('checkout_url'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
  adminNote: text('admin_note'),
  refundedAmountUsd: doublePrecision('refunded_amount_usd'),
  refundReason: text('refund_reason'),
  confirmedByAdminId: integer('confirmed_by_admin_id'),
  paidAt: timestamp('paid_at'),
  refundedAt: timestamp('refunded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const datingSubscriptions = pgTable('dating_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  packageId: integer('package_id')
    .references(() => datingPackages.id)
    .notNull(),
  packageName: text('package_name').notNull(),
  amountUsd: doublePrecision('amount_usd').notNull(),
  selectionLimit: integer('selection_limit'), // null for 30-day unlimited
  selectionsUsed: integer('selections_used').notNull().default(0),
  isUnlimited: boolean('is_unlimited').notNull().default(false),
  status: text('status').notNull().default('active'), // 'active' | 'exhausted' | 'expired' | 'refunded'
  paymentTransactionId: integer('payment_transaction_id').references(() => paymentTransactions.id),
  startsAt: timestamp('starts_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const datingSelections = pgTable(
  'dating_selections',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    subscriptionId: integer('subscription_id')
      .references(() => datingSubscriptions.id, { onDelete: 'cascade' })
      .notNull(),
    targetProfileId: integer('target_profile_id')
      .references(() => datingProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    targetUserId: integer('target_user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('dating_sel_sub_target_idx').on(table.subscriptionId, table.targetProfileId)]
);

export const datingBlocks = pgTable(
  'dating_blocks',
  {
    id: serial('id').primaryKey(),
    blockerUserId: integer('blocker_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    blockedProfileId: integer('blocked_profile_id')
      .references(() => datingProfiles.id, { onDelete: 'cascade' })
      .notNull(),
    blockedUserId: integer('blocked_user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('dating_blocks_pair_idx').on(table.blockerUserId, table.blockedProfileId)]
);

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  listingType: text('listing_type').notNull(), // 'job' | 'market' | 'house' | 'dating'
  listingId: integer('listing_id').notNull(),
  listingTitle: text('listing_title').notNull(),
  reporterUserId: integer('reporter_user_id'),
  reporterName: text('reporter_name').notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dismissed'
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  category: text('category').notNull(), // 'approval' | 'verification' | 'sponsorship' | 'account' | 'dating' | 'payment'
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(), // 'super_admin' | 'moderator' | 'user_manager' | 'sponsorship_manager'
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorType: text('actor_type').notNull(), // 'user' | 'admin' | 'system'
  actorId: text('actor_id'),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  jobs: many(jobs),
  marketItems: many(marketItems),
  houses: many(houses),
  sponsorshipPayments: many(sponsorshipPayments),
  paymentTransactions: many(paymentTransactions),
  datingSubscriptions: many(datingSubscriptions),
  datingProfile: one(datingProfiles, {
    fields: [users.id],
    references: [datingProfiles.userId],
  }),
  notifications: many(notifications),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  author: one(users, {
    fields: [jobs.userId],
    references: [users.id],
  }),
}));

export const marketItemsRelations = relations(marketItems, ({ one }) => ({
  author: one(users, {
    fields: [marketItems.userId],
    references: [users.id],
  }),
}));

export const housesRelations = relations(houses, ({ one }) => ({
  author: one(users, {
    fields: [houses.userId],
    references: [users.id],
  }),
}));

export const sponsorshipPaymentsRelations = relations(sponsorshipPayments, ({ one }) => ({
  user: one(users, {
    fields: [sponsorshipPayments.userId],
    references: [users.id],
  }),
  plan: one(sponsorshipPlans, {
    fields: [sponsorshipPayments.planId],
    references: [sponsorshipPlans.id],
  }),
}));

export const datingProfilesRelations = relations(datingProfiles, ({ one }) => ({
  user: one(users, {
    fields: [datingProfiles.userId],
    references: [users.id],
  }),
}));

export const datingSubscriptionsRelations = relations(datingSubscriptions, ({ one, many }) => ({
  user: one(users, {
    fields: [datingSubscriptions.userId],
    references: [users.id],
  }),
  pkg: one(datingPackages, {
    fields: [datingSubscriptions.packageId],
    references: [datingPackages.id],
  }),
  selections: many(datingSelections),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));
