import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  datingPackages,
  datingSubscriptions,
  houses,
  jobs,
  marketItems,
  paymentTransactions,
  sponsorshipPayments,
  sponsorshipPlans,
} from '../src/db/schema.ts';
import { logAudit, notifyUser } from './repository.ts';

export type PaymentGateway = 'paynow' | 'paypal' | 'manual';
export type PaymentFeatureType =
  | 'dating_package'
  | 'sponsored_job'
  | 'sponsored_market'
  | 'sponsored_house';

export function getGatewayCapabilities() {
  const paynowConfigured = Boolean(
    (process.env.PAYNOW_INTEGRATION_ID ?? '').trim() &&
      (process.env.PAYNOW_INTEGRATION_KEY ?? '').trim()
  );
  const paypalConfigured = Boolean(
    (process.env.PAYPAL_CLIENT_ID ?? '').trim() &&
      (process.env.PAYPAL_CLIENT_SECRET ?? '').trim()
  );
  const paypalMode =
    (process.env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';

  return {
    paynowConfigured,
    paypalConfigured,
    paypalMode,
    manualEnabled: true,
  };
}

function getAppBaseUrl(reqOrigin?: string): string {
  const configured = (process.env.APP_URL ?? '').trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  if (reqOrigin && /^https?:\/\//i.test(reqOrigin)) {
    return reqOrigin.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

// ============================================================================
// Paynow Zimbabwe Helpers (Official SHA-512 URL-encoded Message Protocol)
// ============================================================================
export function generatePaynowHash(fieldsInOrder: Array<[string, string]>, integrationKey: string): string {
  const concatenated = fieldsInOrder.map(([, v]) => v).join('') + integrationKey;
  return crypto.createHash('sha512').update(concatenated, 'utf8').digest('hex').toUpperCase();
}

export function verifyPaynowResponseHash(rawBodyString: string, integrationKey: string): Record<string, string> | null {
  const params = new URLSearchParams(rawBodyString);
  const pairs: Array<[string, string]> = [];
  const obj: Record<string, string> = {};
  let receivedHash = '';

  for (const [k, v] of params.entries()) {
    const lowerKey = k.toLowerCase();
    obj[lowerKey] = v;
    if (lowerKey === 'hash') {
      receivedHash = v.trim().toUpperCase();
    } else {
      pairs.push([k, v]);
    }
  }

  if (!receivedHash) return null;
  const expected = generatePaynowHash(pairs, integrationKey);
  if (receivedHash.length !== expected.length) return null;

  try {
    const match = crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expected));
    return match ? obj : null;
  } catch {
    return null;
  }
}

export async function initiatePaynowCheckout(params: {
  merchantReference: string;
  amountUsd: number;
  title: string;
  userEmail: string;
  baseUrl: string;
}): Promise<{ browserUrl: string; pollUrl: string; paynowRef?: string }> {
  const integrationId = (process.env.PAYNOW_INTEGRATION_ID ?? '').trim();
  const integrationKey = (process.env.PAYNOW_INTEGRATION_KEY ?? '').trim();

  if (!integrationId || !integrationKey) {
    throw new Error(
      'Paynow Zimbabwe is not configured on this server (missing PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY).'
    );
  }

  const returnUrl = `${params.baseUrl}/?paymentGateway=paynow&paymentRef=${encodeURIComponent(params.merchantReference)}`;
  const resultUrl = `${params.baseUrl}/api/payments/paynow/webhook`;

  const fields: Array<[string, string]> = [
    ['id', integrationId],
    ['reference', params.merchantReference],
    ['amount', params.amountUsd.toFixed(2)],
    ['additionalinfo', params.title.slice(0, 100)],
    ['returnurl', returnUrl],
    ['resulturl', resultUrl],
    ['authemail', params.userEmail],
    ['status', 'Message'],
  ];

  const hash = generatePaynowHash(fields, integrationKey);
  const body = new URLSearchParams([...fields, ['hash', hash]]).toString();

  const response = await fetch('https://www.paynow.co.zw/interface/initiatetransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await response.text();
  const parsed = verifyPaynowResponseHash(text, integrationKey);
  if (!parsed) {
    const raw = Object.fromEntries(new URLSearchParams(text).entries());
    throw new Error(raw.error || 'Paynow response hash verification failed.');
  }

  if ((parsed.status ?? '').toLowerCase() !== 'ok') {
    throw new Error(parsed.error || 'Paynow rejected payment initiation.');
  }

  const browserUrl = parsed.browserurl;
  const pollUrl = parsed.pollurl;
  if (!browserUrl || !pollUrl) {
    throw new Error('Paynow returned an incomplete checkout response.');
  }

  return {
    browserUrl,
    pollUrl,
    paynowRef: parsed.paynowreference,
  };
}

export async function pollPaynowStatus(pollUrl: string): Promise<Record<string, string>> {
  const integrationKey = (process.env.PAYNOW_INTEGRATION_KEY ?? '').trim();
  if (!integrationKey) {
    throw new Error('Paynow integration key is not configured.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pollUrl);
  } catch {
    throw new Error('Invalid Paynow poll URL.');
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    (parsedUrl.hostname !== 'www.paynow.co.zw' && parsedUrl.hostname !== 'paynow.co.zw')
  ) {
    throw new Error('Blocked non-Paynow poll URL.');
  }

  const response = await fetch(parsedUrl.toString(), { method: 'POST' });
  const text = await response.text();
  const verified = verifyPaynowResponseHash(text, integrationKey);
  if (!verified) {
    throw new Error('Paynow poll response hash verification failed.');
  }
  return verified;
}

// ============================================================================
// PayPal REST API v2 Helpers
// ============================================================================
function getPayPalApiBase(): string {
  const mode = (process.env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase();
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = (process.env.PAYPAL_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'PayPal is not configured on this server (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).'
    );
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || 'Could not authenticate with PayPal.');
  }
  return data.access_token;
}

export async function createPayPalOrder(params: {
  merchantReference: string;
  amountUsd: number;
  description: string;
  baseUrl: string;
}): Promise<{ orderId: string; approveUrl: string }> {
  const accessToken = await getPayPalAccessToken();
  const returnUrl = `${params.baseUrl}/?paymentGateway=paypal&paymentRef=${encodeURIComponent(params.merchantReference)}`;
  const cancelUrl = `${params.baseUrl}/?paymentGateway=paypal&paymentCancel=1&paymentRef=${encodeURIComponent(params.merchantReference)}`;

  const res = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.merchantReference,
          custom_id: params.merchantReference,
          description: params.description.slice(0, 120),
          amount: {
            currency_code: 'USD',
            value: params.amountUsd.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: 'MARKET & JOBS Zimbabwe',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });

  const data = (await res.json()) as {
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
    message?: string;
  };
  if (!res.ok || !data.id) {
    throw new Error(data.message || 'PayPal order creation failed.');
  }

  const approveUrl = data.links?.find((l) => l.rel === 'approve')?.href;
  if (!approveUrl) {
    throw new Error('PayPal did not return an approval redirect URL.');
  }
  return { orderId: data.id, approveUrl };
}

export async function captureAndVerifyPayPalOrder(params: {
  orderId: string;
  expectedAmountUsd: number;
}): Promise<{ captureId: string; paidAmountUsd: number }> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(params.orderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = (await res.json()) as {
    status?: string;
    message?: string;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          amount?: { value?: string; currency_code?: string };
        }>;
      };
    }>;
  };

  if (!res.ok || data.status !== 'COMPLETED') {
    throw new Error(data.message || 'PayPal payment has not been completed.');
  }

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture || capture.status !== 'COMPLETED' || !capture.id) {
    throw new Error('PayPal capture record is missing or incomplete.');
  }

  const paidAmountUsd = Number(capture.amount?.value ?? 0);
  const currency = capture.amount?.currency_code ?? '';
  if (currency !== 'USD' || paidAmountUsd < params.expectedAmountUsd - 0.01) {
    throw new Error('Captured PayPal amount or currency does not match package price.');
  }

  return { captureId: capture.id, paidAmountUsd };
}

export async function verifyPayPalWebhookSignature(params: {
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown;
}): Promise<boolean> {
  const webhookId = (process.env.PAYPAL_WEBHOOK_ID ?? '').trim();
  if (!webhookId) return false;

  const accessToken = await getPayPalAccessToken();
  const res = await fetch(`${getPayPalApiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: params.headers['paypal-auth-algo'],
      cert_url: params.headers['paypal-cert-url'],
      transmission_id: params.headers['paypal-transmission-id'],
      transmission_sig: params.headers['paypal-transmission-sig'],
      transmission_time: params.headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: params.rawBody,
    }),
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === 'SUCCESS';
}

export async function executePayPalRefund(params: {
  captureId: string;
  amountUsd: number;
  note?: string;
}): Promise<{ refundId: string }> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalApiBase()}/v2/payments/captures/${encodeURIComponent(params.captureId)}/refund`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: {
          currency_code: 'USD',
          value: params.amountUsd.toFixed(2),
        },
        note_to_payer: (params.note || 'Refund processed by MARKET & JOBS Zimbabwe').slice(0, 200),
      }),
    }
  );
  const data = (await res.json()) as { id?: string; status?: string; message?: string };
  if (!res.ok || !data.id) {
    throw new Error(data.message || 'PayPal refund failed.');
  }
  return { refundId: data.id };
}

// ============================================================================
// Central Idempotent Transaction Fulfillment & Refund Engine
// ============================================================================
export async function fulfillPaidTransaction(params: {
  transactionId: number;
  gatewayReference?: string | null;
  gatewayCaptureId?: string | null;
  adminId?: number | null;
  adminName?: string | null;
  adminNote?: string | null;
}) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.transactionId))
      .limit(1);

    if (!existing) {
      throw new Error('Payment transaction not found.');
    }

    // Idempotent guard: already paid -> return without double-activating
    if (existing.status === 'paid') {
      return { alreadyPaid: true, transaction: existing };
    }
    if (existing.status === 'refunded') {
      throw new Error('Refunded payment cannot be re-activated.');
    }

    const now = new Date();
    const [updatedTx] = await tx
      .update(paymentTransactions)
      .set({
        status: 'paid',
        gatewayReference: params.gatewayReference ?? existing.gatewayReference,
        gatewayCaptureId: params.gatewayCaptureId ?? existing.gatewayCaptureId,
        confirmedByAdminId: params.adminId ?? existing.confirmedByAdminId,
        adminNote: params.adminNote ?? existing.adminNote,
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(paymentTransactions.id, existing.id))
      .returning();

    if (existing.featureType === 'dating_package') {
      const [pkg] = await tx
        .select()
        .from(datingPackages)
        .where(eq(datingPackages.id, existing.targetId))
        .limit(1);

      if (!pkg) {
        throw new Error('Dating package linked to payment no longer exists.');
      }

      // Mark any older active subscription superseded/expired only if user buys Unlimited or new pack;
      // actually keep old unused or close previous active so user always has one clean current subscription
      await tx
        .update(datingSubscriptions)
        .set({ status: 'expired' })
        .where(
          and(
            eq(datingSubscriptions.userId, existing.userId),
            eq(datingSubscriptions.status, 'active')
          )
        );

      const expiresAt =
        pkg.durationDays && pkg.durationDays > 0
          ? new Date(now.getTime() + 1000 * 60 * 60 * 24 * pkg.durationDays)
          : null;

      await tx.insert(datingSubscriptions).values({
        userId: existing.userId,
        packageId: pkg.id,
        packageName: pkg.name,
        amountUsd: existing.amountUsd,
        selectionLimit: pkg.isUnlimited ? null : pkg.maxSelections,
        selectionsUsed: 0,
        isUnlimited: pkg.isUnlimited,
        status: 'active',
        paymentTransactionId: existing.id,
        startsAt: now,
        expiresAt,
      });
    } else if (
      existing.featureType === 'sponsored_job' ||
      existing.featureType === 'sponsored_market' ||
      existing.featureType === 'sponsored_house'
    ) {
      const planId = existing.planOrPackageId ?? Number(existing.metadataJson?.planId || 0);
      const [plan] = planId
        ? await tx.select().from(sponsorshipPlans).where(eq(sponsorshipPlans.id, planId)).limit(1)
        : [];
      const durationDays =
        plan?.durationDays ?? Number(existing.metadataJson?.durationDays || 7);
      const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * durationDays);

      const listingType =
        existing.featureType === 'sponsored_job'
          ? 'job'
          : existing.featureType === 'sponsored_market'
            ? 'market'
            : 'house';

      if (listingType === 'job') {
        await tx
          .update(jobs)
          .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: now })
          .where(eq(jobs.id, existing.targetId));
      } else if (listingType === 'market') {
        await tx
          .update(marketItems)
          .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: now })
          .where(eq(marketItems.id, existing.targetId));
      } else {
        await tx
          .update(houses)
          .set({ isSponsored: true, sponsoredUntil: expiresAt, updatedAt: now })
          .where(eq(houses.id, existing.targetId));
      }

      // Sync or insert sponsorship_payments record for complete compatibility
      const legacyPaymentId = Number(existing.metadataJson?.legacySponsorshipPaymentId || 0);
      if (legacyPaymentId > 0) {
        await tx
          .update(sponsorshipPayments)
          .set({
            status: 'confirmed',
            startsAt: now,
            expiresAt,
            confirmedByAdminId: params.adminId ?? null,
            adminNote: params.adminNote ?? null,
          })
          .where(eq(sponsorshipPayments.id, legacyPaymentId));
      } else {
        await tx.insert(sponsorshipPayments).values({
          userId: existing.userId,
          listingType,
          listingId: existing.targetId,
          listingTitle: existing.targetTitle,
          planId: plan?.id ?? null,
          durationDays,
          amountUsd: existing.amountUsd,
          paymentMethod: existing.gateway,
          paymentReference: params.gatewayReference ?? existing.merchantReference,
          status: 'confirmed',
          startsAt: now,
          expiresAt,
          confirmedByAdminId: params.adminId ?? null,
        });
      }
    }

    return { alreadyPaid: false, transaction: updatedTx };
  });

  if (!result.alreadyPaid) {
    const txRow = result.transaction;
    await notifyUser({
      userId: txRow.userId,
      title:
        txRow.featureType === 'dating_package'
          ? 'Dating Package Activated'
          : 'Sponsorship Payment Confirmed',
      message:
        txRow.featureType === 'dating_package'
          ? `Your $${txRow.amountUsd} payment for "${txRow.targetTitle}" is confirmed. You can now choose singles on the Singles tab.`
          : `Your $${txRow.amountUsd} payment for "${txRow.targetTitle}" is confirmed and sponsorship is now active.`,
      category: txRow.featureType === 'dating_package' ? 'dating' : 'payment',
    });

    await logAudit({
      actorType: params.adminId ? 'admin' : 'system',
      actorId: params.adminId ? String(params.adminId) : null,
      actorName: params.adminName || 'Payment Gateway',
      action: 'central_payment_fulfilled',
      targetType: txRow.featureType,
      targetId: String(txRow.id),
      summary: `${params.adminName || txRow.gateway.toUpperCase()} verified & activated $${txRow.amountUsd} (${txRow.featureType}) ref ${txRow.merchantReference}`,
    });
  }

  return result;
}

export async function refundCentralTransaction(params: {
  transactionId: number;
  adminId: number;
  adminName: string;
  reason: string;
}) {
  const [txRow] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, params.transactionId))
    .limit(1);

  if (!txRow) {
    throw new Error('Transaction not found.');
  }
  if (txRow.status !== 'paid') {
    throw new Error(`Only paid transactions can be refunded (current status: ${txRow.status}).`);
  }

  let gatewayRefundNote = '';
  if (txRow.gateway === 'paypal' && txRow.gatewayCaptureId) {
    const refund = await executePayPalRefund({
      captureId: txRow.gatewayCaptureId,
      amountUsd: txRow.amountUsd,
      note: params.reason,
    });
    gatewayRefundNote = `PayPal Refund ID: ${refund.refundId}`;
  }

  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const resRows = await tx
      .update(paymentTransactions)
      .set({
        status: 'refunded',
        refundedAmountUsd: txRow.amountUsd,
        refundReason: gatewayRefundNote
          ? `${params.reason} (${gatewayRefundNote})`
          : params.reason,
        confirmedByAdminId: params.adminId,
        refundedAt: now,
        updatedAt: now,
      })
      .where(eq(paymentTransactions.id, txRow.id))
      .returning();

    if (txRow.featureType === 'dating_package') {
      await tx
        .update(datingSubscriptions)
        .set({ status: 'refunded' })
        .where(eq(datingSubscriptions.paymentTransactionId, txRow.id));
    } else if (txRow.featureType === 'sponsored_job') {
      await tx
        .update(jobs)
        .set({ isSponsored: false, sponsoredUntil: null, updatedAt: now })
        .where(eq(jobs.id, txRow.targetId));
    } else if (txRow.featureType === 'sponsored_market') {
      await tx
        .update(marketItems)
        .set({ isSponsored: false, sponsoredUntil: null, updatedAt: now })
        .where(eq(marketItems.id, txRow.targetId));
    } else if (txRow.featureType === 'sponsored_house') {
      await tx
        .update(houses)
        .set({ isSponsored: false, sponsoredUntil: null, updatedAt: now })
        .where(eq(houses.id, txRow.targetId));
    }

    return resRows;
  });

  await notifyUser({
    userId: txRow.userId,
    title: 'Payment Refunded',
    message: `Your $${txRow.amountUsd} payment for "${txRow.targetTitle}" (${txRow.merchantReference}) has been refunded. Reason: ${params.reason}`,
    category: 'payment',
  });

  await logAudit({
    actorType: 'admin',
    actorId: String(params.adminId),
    actorName: params.adminName,
    action: 'payment_refunded',
    targetType: txRow.featureType,
    targetId: String(txRow.id),
    summary: `${params.adminName} refunded $${txRow.amountUsd} (${txRow.gateway}) for ${txRow.merchantReference}: ${params.reason}`,
  });

  return updated;
}

export function resolveBaseUrlFromRequest(originHeader?: string, hostHeader?: string, protocol?: string): string {
  if (originHeader) return getAppBaseUrl(originHeader);
  if (hostHeader) return getAppBaseUrl(`${protocol || 'https'}://${hostHeader}`);
  return getAppBaseUrl();
}
