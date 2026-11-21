import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'market_jobs.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    city TEXT NOT NULL,
    avatar TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT NOT NULL,
    salary TEXT,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS market_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    photos TEXT NOT NULL DEFAULT '[]',
    whatsapp TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS houses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    property_type TEXT NOT NULL,
    title TEXT NOT NULL,
    suburb TEXT NOT NULL,
    city TEXT NOT NULL,
    price REAL NOT NULL,
    bedrooms INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL,
    facilities TEXT NOT NULL DEFAULT '[]',
    photos TEXT NOT NULL DEFAULT '[]',
    whatsapp TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_created ON market_items (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_houses_created ON houses (created_at DESC);
`);

function seedInitialListings() {
  const now = Date.now();
  const hour = 3600 * 1000;

  const jobCount = (db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count;
  if (jobCount === 0) {
    const insertJob = db.prepare(`
      INSERT INTO jobs (id, user_id, author_name, title, company, description, requirements, salary, category, location, whatsapp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertJob.run(
      'seed-job-1',
      'community-seed',
      'Kudakwashe Moyo',
      'Solar Technician & Installer',
      'SunGrid Zimbabwe',
      'Install and maintain hybrid 3kVA–10kVA residential solar systems across Harare suburbs. Full-time field role with transport provided.',
      '2+ years hands-on inverter & lithium battery installation experience, clean Class 4 driver licence preferred.',
      'USD 650/month',
      'Trades & Artisans',
      'Harare',
      '+263772410885',
      now - hour * 2
    );

    insertJob.run(
      'seed-job-2',
      'community-seed',
      'Nomsa Sibanda',
      'Retail Sales Supervisor',
      'Highland Hardware',
      'Oversee daily counter sales, stock counts, and customer service at our Bulawayo CBD hardware branch.',
      '5 O-Levels including English & Maths, 3 years retail supervisory experience, honest and well-spoken.',
      'USD 480/month',
      'Sales & Retail',
      'Bulawayo',
      '+263719334210',
      now - hour * 5
    );

    insertJob.run(
      'seed-job-3',
      'community-seed',
      'Tendai Chikwanda',
      'Class 2 Delivery Driver',
      'Eastern Highlands Logistics',
      'Mutare to Harare weekly freight deliveries. Well-maintained 8-tonne truck, overnight allowances paid.',
      'Valid Class 2 licence, Defensive Driving Certificate, medical certificate, traceable references.',
      'USD 550 + allowances',
      'Driving & Logistics',
      'Mutare',
      '+263774889120',
      now - hour * 11
    );
  }

  const marketCount = (db.prepare('SELECT COUNT(*) AS count FROM market_items').get() as { count: number }).count;
  if (marketCount === 0) {
    const insertMarket = db.prepare(`
      INSERT INTO market_items (id, user_id, author_name, title, price, currency, description, category, location, photos, whatsapp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMarket.run(
      'seed-market-1',
      'community-seed',
      'Tafadzwa Ndlovu',
      '5kVA Hybrid Solar Inverter + 5kWh Lithium Battery',
      1450,
      'USD',
      'Brand new 5kVA pure sine wave hybrid inverter paired with 5kWh LiFePO4 battery pack. 2-year warranty, installation available in Harare & Chitungwiza.',
      'Electronics & Solar',
      'Harare',
      JSON.stringify(['/src/assets/images/market_solar_kit_1795256609472.jpg']),
      '+263773512904',
      now - hour * 1
    );

    insertMarket.run(
      'seed-market-2',
      'community-seed',
      'Rumbidzai Gono',
      'Core i5 Business Laptop (16GB RAM / 512GB SSD)',
      340,
      'USD',
      'Clean silver ultrabook in great condition, strong 6-hour battery, backlit keyboard, charger included. Ready for work or varsity.',
      'Phones & Computers',
      'Bulawayo',
      JSON.stringify(['/src/assets/images/market_laptop_desk_1795256608982.jpg']),
      '+263782904112',
      now - hour * 4
    );

    insertMarket.run(
      'seed-market-3',
      'community-seed',
      'Farai Makoni',
      'Fresh Farm Tomatoes & Green Peppers (Wholesale Crates)',
      18,
      'USD',
      'Grade A fresh tomatoes and crisp green peppers harvested daily from our Marondera farm. Delivery to Mbare or direct collection.',
      'Farm & Produce',
      'Marondera',
      JSON.stringify(['/src/assets/images/market_farm_produce_1795256608260.jpg']),
      '+263775618230',
      now - hour * 9
    );
  }

  const houseCount = (db.prepare('SELECT COUNT(*) AS count FROM houses').get() as { count: number }).count;
  if (houseCount === 0) {
    const insertHouse = db.prepare(`
      INSERT INTO houses (id, user_id, author_name, property_type, title, suburb, city, price, bedrooms, description, facilities, photos, whatsapp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertHouse.run(
      'seed-house-1',
      'community-seed',
      'Mrs Chipo Nyathi',
      'Cottage',
      'Neat 2-Bedroom Garden Cottage',
      'Avondale',
      'Harare',
      450,
      2,
      'Quiet, self-contained 2-bedroom brick cottage in a leafy Avondale yard. Features a fitted kitchen, bright lounge, paved parking, reliable borehole water, and solar backup.',
      JSON.stringify(['Borehole Water', 'Solar Backup', 'Walled & Gated', 'Parking Space']),
      JSON.stringify(['/src/assets/images/house_harare_cottage_1795256608629.jpg']),
      '+263772819440',
      now - hour * 3
    );

    insertHouse.run(
      'seed-house-2',
      'community-seed',
      'Bongani Dube',
      'Apartment',
      'Modern 2-Bedroom Sunny Apartment',
      'Suburbs',
      'Bulawayo',
      380,
      2,
      'Spacious modern apartment with porcelain tiled floors, open-plan fitted kitchen, and large sunlit windows. Secure complex close to shops and schools.',
      JSON.stringify(['Prepaid ZESA', 'Fitted Kitchen', 'Parking Space', 'Walled & Gated']),
      JSON.stringify(['/src/assets/images/house_flat_interior_1795256609336.jpg']),
      '+263712667891',
      now - hour * 6
    );

    insertHouse.run(
      'seed-house-3',
      'community-seed',
      'Tatenda Zvobgo',
      'Room',
      'Clean Single Room with Separate Entrance',
      'Kuwadzana Phase 3',
      'Harare',
      95,
      1,
      'Tiled single room suitable for a working professional or couple. Own prepaid ZESA sub-meter, borehole water on site, walled and gated yard.',
      JSON.stringify(['Borehole Water', 'Prepaid ZESA', 'Walled & Gated']),
      JSON.stringify([]),
      '+263778102394',
      now - hour * 12
    );
  }
}

seedInitialListings();
