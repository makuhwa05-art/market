# MARKET & JOBS ZIMBABWE — Setup & Deployment Guide

## Architecture Overview
- **Frontend**: React 19 + Vite + Tailwind CSS v4 (4 public tabs: **Jobs**, **Market**, **Houses**, and **Singles**, mobile-first with `+263` WhatsApp click-to-chat and client-side image compression).
- **Backend**: Node.js + Express (`server.ts`, `server/datingAndPaymentsRoutes.ts`, `server/payments.ts`) serving API routes, central payment webhooks/verification, and built SPA assets.
- **Database**: **Cloud SQL (PostgreSQL)** via **Drizzle ORM** (`src/db/schema.ts`, `src/db/index.ts`).
- **Authentication**:
  - Public Users: **Firebase Authentication** (Google Sign-In verified server-side via `firebase-admin`), paired with Zimbabwean profile completion (`+263` phone/WhatsApp, city, optional avatar, optional 18+ Dating opt-in).
  - Administrators: Private `/admin` console using scrypt-hashed passwords + HMAC-SHA256 tokens and server-side RBAC permissions (`super_admin`, `moderator`, `user_manager`, `sponsorship_manager`).
- **Central Payment System**: Unified `payment_transactions` ledger powering Dating USD Packages (`$6` 1–3 singles, `$10` 4–15 singles, `$20` 30-day unlimited), Sponsored Listings, and Manual EcoCash/InnBucks fallback via **Paynow Zimbabwe** & **PayPal REST v2** with server-side verification and refunds.
- **AI Property Copywriting**: `@google/genai` (`gemini-4-hydrogen`) on `/api/houses/generate-description`.

## 1. Environment Variables
Configure the following in your `.env` / Settings > Secrets (never commit secrets):

- `SQL_HOST`: Cloud SQL PostgreSQL host
- `SQL_USER`: PostgreSQL username
- `SQL_PASSWORD`: PostgreSQL password
- `SQL_DB_NAME`: PostgreSQL database name
- `GEMINI_API_KEY`: Gemini API key for AI house description generation
- `PAYNOW_INTEGRATION_ID` *(optional)*: Paynow Zimbabwe Merchant Integration ID
- `PAYNOW_INTEGRATION_KEY` *(optional)*: Paynow Zimbabwe Integration Key (SHA-512 hash signing)
- `PAYPAL_CLIENT_ID` *(optional)*: PayPal REST API Client ID
- `PAYPAL_CLIENT_SECRET` *(optional)*: PayPal REST API Client Secret
- `PAYPAL_MODE` *(optional)*: `sandbox` or `live`
- `PAYPAL_WEBHOOK_ID` *(optional)*: PayPal Webhook ID for signature verification
- `SUPER_ADMIN_USERNAME` *(optional)*: Initial Super Admin username (e.g. `superadmin`)
- `ADMIN_PASSCODE` *(optional)*: Initial Super Admin password (8+ characters); if omitted, claim the initial Super Admin account interactively on `/admin`
- `ADMIN_TOKEN_SECRET` *(recommended in production)*: Long random secret used to sign administrator session tokens
- `APP_URL`: Public application URL (also used for Paynow & PayPal return/webhook URLs)

## 2. Install Dependencies & Push Schema
```bash
npm install
npx drizzle-kit push --config=src/db/drizzle.config.ts
```

## 3. Run in Development or Production
```bash
# Development (Express + Vite middleware on port 3000)
npm run dev

# Production Build & Start
npm run build
npm run start
```

## 4. Initial Super Admin, Roles & Payment Webhooks
1. Either set `SUPER_ADMIN_USERNAME` and `ADMIN_PASSCODE` in environment secrets, or visit `/admin` before any Super Admin exists and complete the one-time **Claim Super Admin Access** form.
2. Sign in to `/admin` -> **Administrators** to create **Moderator**, **User Manager**, or **Sponsorship Manager** accounts and customize granular permissions (`manage_users`, `verify_users`, `moderate_ads`, `manage_dating`, `manage_sponsorships`, `manage_payments`, `manage_reports`, `manage_categories`, `manage_admins`, `view_logs`, `manage_settings`).
3. Configure payment gateway webhooks in your merchant dashboards to point to `${APP_URL}/api/payments/paynow/webhook` and `${APP_URL}/api/payments/paypal/webhook`.
