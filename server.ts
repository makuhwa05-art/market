import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db.ts';
import { hashPassword, signAuthToken, verifyAuthToken, verifyPassword } from './server/auth.ts';
import { isValidZimbabwePhone, normalizeZimbabwePhone, sanitizeImageValue, sanitizePhotosArray } from './server/phone.ts';

interface AuthUser {
  id: string;
  fullName: string;
  phone: string;
  city: string;
  avatar: string | null;
  createdAt: number;
}

interface AuthedRequest extends express.Request {
  authUser?: AuthUser;
}

interface DbUserRow {
  id: string;
  full_name: string;
  phone: string;
  password_hash: string;
  city: string;
  avatar: string | null;
  created_at: number;
}

interface DbJobRow {
  id: string;
  user_id: string;
  author_name: string;
  title: string;
  company: string;
  description: string;
  requirements: string;
  salary: string | null;
  category: string;
  location: string;
  whatsapp: string;
  created_at: number;
}

interface DbMarketRow {
  id: string;
  user_id: string;
  author_name: string;
  title: string;
  price: number;
  currency: string;
  description: string;
  category: string;
  location: string;
  photos: string;
  whatsapp: string;
  created_at: number;
}

interface DbHouseRow {
  id: string;
  user_id: string;
  author_name: string;
  property_type: string;
  title: string;
  suburb: string;
  city: string;
  price: number;
  bedrooms: number;
  description: string;
  facilities: string;
  photos: string;
  whatsapp: string;
  created_at: number;
}

function toUserProfile(row: DbUserRow): AuthUser {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    city: row.city,
    avatar: row.avatar,
    createdAt: row.created_at,
  };
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toJobDto(row: DbJobRow) {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name,
    title: row.title,
    company: row.company,
    description: row.description,
    requirements: row.requirements,
    salary: row.salary,
    category: row.category,
    location: row.location,
    whatsapp: row.whatsapp,
    createdAt: row.created_at,
  };
}

function toMarketDto(row: DbMarketRow) {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name,
    title: row.title,
    price: row.price,
    currency: row.currency === 'ZiG' ? 'ZiG' : 'USD',
    description: row.description,
    category: row.category,
    location: row.location,
    photos: safeParseJsonArray(row.photos),
    whatsapp: row.whatsapp,
    createdAt: row.created_at,
  };
}

function toHouseDto(row: DbHouseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name,
    propertyType: row.property_type,
    title: row.title,
    suburb: row.suburb,
    city: row.city,
    price: row.price,
    bedrooms: row.bedrooms,
    description: row.description,
    facilities: safeParseJsonArray(row.facilities),
    photos: safeParseJsonArray(row.photos),
    whatsapp: row.whatsapp,
    createdAt: row.created_at,
  };
}

function cleanText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function authenticateToken(req: AuthedRequest): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const verified = verifyAuthToken(token);
  if (!verified) return null;
  const row = db
    .prepare('SELECT id, full_name, phone, password_hash, city, avatar, created_at FROM users WHERE id = ?')
    .get(verified.userId) as DbUserRow | undefined;
  return row ? toUserProfile(row) : null;
}

function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const user = authenticateToken(req);
  if (!user) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  req.authUser = user;
  next();
}

const VALID_HOUSE_TYPES = new Set(['House', 'Room', 'Flat', 'Apartment', 'Cottage', 'Commercial']);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '6mb' }));

  // Auth & Profile Routes
  app.post('/api/auth/register', (req, res) => {
    const fullName = cleanText(req.body?.fullName, 80);
    const rawPhone = cleanText(req.body?.phone, 30);
    const city = cleanText(req.body?.city, 60);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const avatar = sanitizeImageValue(req.body?.avatar);

    if (fullName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (!isValidZimbabwePhone(rawPhone)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe phone/WhatsApp number (e.g. 0771234567).' });
      return;
    }
    if (!city) {
      res.status(400).json({ error: 'Please select your city or location.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const phone = normalizeZimbabwePhone(rawPhone);
    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (existing) {
      res.status(409).json({ error: 'An account with this WhatsApp number already exists. Please sign in.' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const passwordHash = hashPassword(password);

    db.prepare(
      'INSERT INTO users (id, full_name, phone, password_hash, city, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, fullName, phone, passwordHash, city, avatar, createdAt);

    const user: AuthUser = { id, fullName, phone, city, avatar, createdAt };
    const token = signAuthToken(id);
    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const rawPhone = cleanText(req.body?.phone, 30);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidZimbabwePhone(rawPhone) || !password) {
      res.status(400).json({ error: 'Enter your Zimbabwe phone number and password.' });
      return;
    }

    const phone = normalizeZimbabwePhone(rawPhone);
    const row = db
      .prepare('SELECT id, full_name, phone, password_hash, city, avatar, created_at FROM users WHERE phone = ?')
      .get(phone) as DbUserRow | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Incorrect phone number or password.' });
      return;
    }

    const token = signAuthToken(row.id);
    res.json({ token, user: toUserProfile(row) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.authUser });
  });

  app.put('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const fullName = cleanText(req.body?.fullName, 80);
    const rawPhone = cleanText(req.body?.phone, 30);
    const city = cleanText(req.body?.city, 60);
    const avatarInput = req.body?.avatar;
    const avatar = avatarInput === null ? null : sanitizeImageValue(avatarInput) ?? user.avatar;

    if (fullName.length < 2) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }
    if (!isValidZimbabwePhone(rawPhone)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe phone/WhatsApp number.' });
      return;
    }
    if (!city) {
      res.status(400).json({ error: 'City or location is required.' });
      return;
    }

    const phone = normalizeZimbabwePhone(rawPhone);
    const conflict = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, user.id);
    if (conflict) {
      res.status(409).json({ error: 'That phone number is already used by another account.' });
      return;
    }

    db.prepare('UPDATE users SET full_name = ?, phone = ?, city = ?, avatar = ? WHERE id = ?').run(
      fullName,
      phone,
      city,
      avatar,
      user.id
    );

    // Sync author name on user's existing listings
    db.prepare('UPDATE jobs SET author_name = ? WHERE user_id = ?').run(fullName, user.id);
    db.prepare('UPDATE market_items SET author_name = ? WHERE user_id = ?').run(fullName, user.id);
    db.prepare('UPDATE houses SET author_name = ? WHERE user_id = ?').run(fullName, user.id);

    const updated: AuthUser = { ...user, fullName, phone, city, avatar };
    res.json({ user: updated });
  });

  // Jobs Routes
  app.get('/api/jobs', (req, res) => {
    const q = cleanText(req.query.q, 100).toLowerCase();
    const location = cleanText(req.query.location, 60);
    const category = cleanText(req.query.category, 60);
    const mine = req.query.mine === 'true';
    const currentUser = mine ? authenticateToken(req as AuthedRequest) : null;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (mine) {
      if (!currentUser) {
        res.status(401).json({ error: 'Sign in required.' });
        return;
      }
      conditions.push('user_id = ?');
      params.push(currentUser.id);
    }

    if (location && location !== 'All') {
      conditions.push('LOWER(location) = LOWER(?)');
      params.push(location);
    }
    if (category && category !== 'All') {
      conditions.push('category = ?');
      params.push(category);
    }
    if (q) {
      const like = `%${q}%`;
      conditions.push('(LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ?)');
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 200`).all(...params) as DbJobRow[];
    res.json({ items: rows.map(toJobDto) });
  });

  app.post('/api/jobs', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const title = cleanText(req.body?.title, 120);
    const company = cleanText(req.body?.company, 100);
    const description = cleanText(req.body?.description, 2500);
    const requirements = cleanText(req.body?.requirements, 1500);
    const salary = cleanText(req.body?.salary, 80) || null;
    const category = cleanText(req.body?.category, 60) || 'Sales & Retail';
    const location = cleanText(req.body?.location, 60);
    const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.phone;

    if (!title || !company || !description || !requirements || !location) {
      res.status(400).json({ error: 'Please fill in job title, company, description, requirements, and location.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);

    db.prepare(
      `INSERT INTO jobs (id, user_id, author_name, title, company, description, requirements, salary, category, location, whatsapp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, user.id, user.fullName, title, company, description, requirements, salary, category, location, whatsapp, createdAt);

    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as DbJobRow;
    res.status(201).json({ item: toJobDto(row) });
  });

  app.put('/api/jobs/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as DbJobRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
      res.status(403).json({ error: 'You can only edit your own job posts.' });
      return;
    }

    const title = cleanText(req.body?.title, 120);
    const company = cleanText(req.body?.company, 100);
    const description = cleanText(req.body?.description, 2500);
    const requirements = cleanText(req.body?.requirements, 1500);
    const salary = cleanText(req.body?.salary, 80) || null;
    const category = cleanText(req.body?.category, 60) || existing.category;
    const location = cleanText(req.body?.location, 60);
    const rawWhatsapp = cleanText(req.body?.whatsapp, 30);

    if (!title || !company || !description || !requirements || !location) {
      res.status(400).json({ error: 'All required job fields must be completed.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);
    db.prepare(
      `UPDATE jobs SET title = ?, company = ?, description = ?, requirements = ?, salary = ?, category = ?, location = ?, whatsapp = ?
       WHERE id = ? AND user_id = ?`
    ).run(title, company, description, requirements, salary, category, location, whatsapp, existing.id, user.id);

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(existing.id) as DbJobRow;
    res.json({ item: toJobDto(updated) });
  });

  app.delete('/api/jobs/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT user_id FROM jobs WHERE id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
      res.status(403).json({ error: 'You can only delete your own job posts.' });
      return;
    }
    db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    res.json({ ok: true });
  });

  // Market Routes
  app.get('/api/market', (req, res) => {
    const q = cleanText(req.query.q, 100).toLowerCase();
    const location = cleanText(req.query.location, 60);
    const category = cleanText(req.query.category, 60);
    const mine = req.query.mine === 'true';
    const currentUser = mine ? authenticateToken(req as AuthedRequest) : null;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (mine) {
      if (!currentUser) {
        res.status(401).json({ error: 'Sign in required.' });
        return;
      }
      conditions.push('user_id = ?');
      params.push(currentUser.id);
    }

    if (location && location !== 'All') {
      conditions.push('LOWER(location) = LOWER(?)');
      params.push(location);
    }
    if (category && category !== 'All') {
      conditions.push('category = ?');
      params.push(category);
    }
    if (q) {
      const like = `%${q}%`;
      conditions.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ? OR LOWER(category) LIKE ?)');
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM market_items ${where} ORDER BY created_at DESC LIMIT 200`).all(...params) as DbMarketRow[];
    res.json({ items: rows.map(toMarketDto) });
  });

  app.post('/api/market', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const title = cleanText(req.body?.title, 120);
    const price = Number(req.body?.price);
    const currency = req.body?.currency === 'ZiG' ? 'ZiG' : 'USD';
    const description = cleanText(req.body?.description, 2500);
    const category = cleanText(req.body?.category, 60) || 'Other';
    const location = cleanText(req.body?.location, 60);
    const photos = sanitizePhotosArray(req.body?.photos, 4);
    const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.phone;

    if (!title || !description || !location || !Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: 'Please fill in item name, valid price, description, and location.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);

    db.prepare(
      `INSERT INTO market_items (id, user_id, author_name, title, price, currency, description, category, location, photos, whatsapp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, user.id, user.fullName, title, price, currency, description, category, location, JSON.stringify(photos), whatsapp, createdAt);

    const row = db.prepare('SELECT * FROM market_items WHERE id = ?').get(id) as DbMarketRow;
    res.status(201).json({ item: toMarketDto(row) });
  });

  app.put('/api/market/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT * FROM market_items WHERE id = ?').get(req.params.id) as DbMarketRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Market listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
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
      res.status(400).json({ error: 'Please complete all required listing fields.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);
    db.prepare(
      `UPDATE market_items SET title = ?, price = ?, currency = ?, description = ?, category = ?, location = ?, photos = ?, whatsapp = ?
       WHERE id = ? AND user_id = ?`
    ).run(title, price, currency, description, category, location, JSON.stringify(photos), whatsapp, existing.id, user.id);

    const updated = db.prepare('SELECT * FROM market_items WHERE id = ?').get(existing.id) as DbMarketRow;
    res.json({ item: toMarketDto(updated) });
  });

  app.delete('/api/market/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT user_id FROM market_items WHERE id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Market listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
      res.status(403).json({ error: 'You can only delete your own market listings.' });
      return;
    }
    db.prepare('DELETE FROM market_items WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    res.json({ ok: true });
  });

  // Houses Routes
  app.get('/api/houses', (req, res) => {
    const q = cleanText(req.query.q, 100).toLowerCase();
    const location = cleanText(req.query.location, 60);
    const propertyType = cleanText(req.query.propertyType, 40);
    const mine = req.query.mine === 'true';
    const currentUser = mine ? authenticateToken(req as AuthedRequest) : null;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (mine) {
      if (!currentUser) {
        res.status(401).json({ error: 'Sign in required.' });
        return;
      }
      conditions.push('user_id = ?');
      params.push(currentUser.id);
    }

    if (location && location !== 'All') {
      conditions.push('(LOWER(city) = LOWER(?) OR LOWER(suburb) LIKE LOWER(?))');
      params.push(location, `%${location}%`);
    }
    if (propertyType && propertyType !== 'All') {
      conditions.push('property_type = ?');
      params.push(propertyType);
    }
    if (q) {
      const like = `%${q}%`;
      conditions.push('(LOWER(title) LIKE ? OR LOWER(suburb) LIKE ? OR LOWER(city) LIKE ? OR LOWER(description) LIKE ?)');
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM houses ${where} ORDER BY created_at DESC LIMIT 200`).all(...params) as DbHouseRow[];
    res.json({ items: rows.map(toHouseDto) });
  });

  app.post('/api/houses', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
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
    const rawWhatsapp = cleanText(req.body?.whatsapp, 30) || user.phone;

    if (!VALID_HOUSE_TYPES.has(propertyType)) {
      res.status(400).json({ error: 'Please select a valid property type.' });
      return;
    }
    if (!title || !suburb || !city || !description || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'Please fill in title, suburb, city, monthly rent, and description.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);

    db.prepare(
      `INSERT INTO houses (id, user_id, author_name, property_type, title, suburb, city, price, bedrooms, description, facilities, photos, whatsapp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      user.id,
      user.fullName,
      propertyType,
      title,
      suburb,
      city,
      price,
      bedrooms,
      description,
      JSON.stringify(facilities),
      JSON.stringify(photos),
      whatsapp,
      createdAt
    );

    const row = db.prepare('SELECT * FROM houses WHERE id = ?').get(id) as DbHouseRow;
    res.status(201).json({ item: toHouseDto(row) });
  });

  app.put('/api/houses/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT * FROM houses WHERE id = ?').get(req.params.id) as DbHouseRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Property listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
      res.status(403).json({ error: 'You can only edit your own property listings.' });
      return;
    }

    const propertyType = cleanText(req.body?.propertyType, 30);
    const title = cleanText(req.body?.title, 120);
    const suburb = cleanText(req.body?.suburb, 80);
    const city = cleanText(req.body?.city, 60);
    const price = Number(req.body?.price);
    const bedroomsRaw = Number(req.body?.bedrooms);
    const bedrooms = Number.isFinite(bedroomsRaw) ? Math.max(0, Math.min(20, Math.round(bedroomsRaw))) : existing.bedrooms;
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
      res.status(400).json({ error: 'Please complete all required property fields.' });
      return;
    }
    if (!isValidZimbabwePhone(rawWhatsapp)) {
      res.status(400).json({ error: 'Please enter a valid Zimbabwe WhatsApp number.' });
      return;
    }

    const whatsapp = normalizeZimbabwePhone(rawWhatsapp);
    db.prepare(
      `UPDATE houses SET property_type = ?, title = ?, suburb = ?, city = ?, price = ?, bedrooms = ?, description = ?, facilities = ?, photos = ?, whatsapp = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      propertyType,
      title,
      suburb,
      city,
      price,
      bedrooms,
      description,
      JSON.stringify(facilities),
      JSON.stringify(photos),
      whatsapp,
      existing.id,
      user.id
    );

    const updated = db.prepare('SELECT * FROM houses WHERE id = ?').get(existing.id) as DbHouseRow;
    res.json({ item: toHouseDto(updated) });
  });

  app.delete('/api/houses/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT user_id FROM houses WHERE id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Property listing not found.' });
      return;
    }
    if (existing.user_id !== user.id) {
      res.status(403).json({ error: 'You can only delete your own property listings.' });
      return;
    }
    db.prepare('DELETE FROM houses WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    res.json({ ok: true });
  });

  // AI-assisted property description generator using @google/genai on the server
  app.post('/api/houses/generate-description', requireAuth, async (req: AuthedRequest, res) => {
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
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
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
        res.status(502).json({ error: 'The AI service returned an empty description. Please try again.' });
        return;
      }

      res.json({ description });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate property description.';
      res.status(502).json({ error: `AI generation failed: ${message}` });
    }
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
