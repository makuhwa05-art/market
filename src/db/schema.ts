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
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull().default(''),
  whatsapp: text('whatsapp').notNull().default(''),
  city: text('city').notNull().default('Harare'),
  avatar: text('avatar'),
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

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  listingType: text('listing_type').notNull(),
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
  category: text('category').notNull(), // 'approval' | 'verification' | 'sponsorship' | 'account'
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

export const usersRelations = relations(users, ({ many }) => ({
  jobs: many(jobs),
  marketItems: many(marketItems),
  houses: many(houses),
  sponsorshipPayments: many(sponsorshipPayments),
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));
