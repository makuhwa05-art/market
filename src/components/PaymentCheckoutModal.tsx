import React, { useState } from 'react';
import { CheckCircle2, CreditCard, Globe, Lock, Smartphone, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { PaymentCapabilities } from '../types';

interface PaymentCheckoutModalProps {
  isOpen: boolean;
  featureType: 'dating_package' | 'sponsored_job' | 'sponsored_market' | 'sponsored_house';
  targetId: number;
  planOrPackageId: number;
  itemTitle: string;
  amountUsd: number;
  subtitle?: string;
  capabilities?: PaymentCapabilities;
  paymentInstructions: string;
  accent?: 'emerald' | 'burgundy';
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function PaymentCheckoutModal({
  isOpen,
  featureType,
  targetId,
  planOrPackageId,
  itemTitle,
  amountUsd,
  subtitle,
  capabilities,
  paymentInstructions,
  accent = 'emerald',
  onClose,
  onSuccess,
}: PaymentCheckoutModalProps) {
  const { authHeaders } = useAuth();
  const [gateway, setGateway] = useState<'paynow' | 'paypal' | 'manual'>(
    capabilities?.paynowConfigured
      ? 'paynow'
      : capabilities?.paypalConfigured
        ? 'paypal'
        : 'manual'
  );
  const [manualMethod, setManualMethod] = useState('EcoCash');
  const [manualReference, setManualReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingTx, setPendingTx] = useState<{
    id: number;
    merchantReference: string;
    checkoutUrl: string | null;
    gateway: string;
  } | null>(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const isBurgundy = accent === 'burgundy';
  const primaryBtn = isBurgundy
    ? 'bg-rose-900 hover:bg-rose-950 text-white'
    : 'bg-emerald-700 hover:bg-emerald-800 text-white';

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (gateway === 'manual' && manualReference.trim().length < 3) {
      setError('Enter the transaction reference from your EcoCash, InnBucks, or Bank payment.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          featureType,
          targetId,
          planOrPackageId,
          gateway,
          manualMethod,
          manualReference: manualReference.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not initiate payment.');
        return;
      }

      if (gateway === 'manual') {
        onSuccess(
          `Payment reference (${data.transaction.merchantReference}) submitted! Access activates once verified by an administrator.`
        );
        onClose();
        return;
      }

      // Paynow / PayPal: navigate same-tab or show secure checkout link + verify button
      setPendingTx({
        id: data.transaction.id,
        merchantReference: data.transaction.merchantReference,
        checkoutUrl: data.checkoutUrl || null,
        gateway,
      });

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      }
    } catch {
      setError('Network error initiating checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyPending = async () => {
    if (!pendingTx) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ transactionId: pendingTx.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.paid) {
        setError(data.error || data.gatewayStatus || 'Payment has not completed yet.');
        return;
      }
      onSuccess(`Payment verified! "${itemTitle}" is now active.`);
      onClose();
    } catch {
      setError('Could not verify payment right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">Secure USD Checkout</h2>
            <p className="text-xs text-slate-500">Server-verified payment · MARKET &amp; JOBS</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div
            className={`p-3.5 rounded-xl border ${
              isBurgundy ? 'bg-rose-50/70 border-rose-200' : 'bg-slate-50 border-slate-200'
            } flex items-center justify-between gap-3`}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{itemTitle}</p>
              {subtitle && <p className="text-xs text-slate-600 mt-0.5">{subtitle}</p>}
            </div>
            <span
              className={`text-lg font-extrabold tabular-nums shrink-0 ${
                isBurgundy ? 'text-rose-900' : 'text-emerald-800'
              }`}
            >
              ${amountUsd} USD
            </span>
          </div>

          {error && (
            <p className="text-xs sm:text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              {error}
            </p>
          )}

          {pendingTx ? (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <p className="text-sm font-semibold text-slate-900">
                Checkout Reference: <span className="font-mono">{pendingTx.merchantReference}</span>
              </p>
              <p className="text-xs text-slate-600">
                Complete your payment on the secure gateway page, then verify below. Access activates only after server confirmation.
              </p>
              {pendingTx.checkoutUrl && (
                <a
                  href={pendingTx.checkoutUrl}
                  className={`w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center ${primaryBtn}`}
                >
                  Continue to {pendingTx.gateway === 'paynow' ? 'Paynow Zimbabwe' : 'PayPal'}
                </a>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={handleVerifyPending}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 inline-flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {submitting ? 'Verifying with Server...' : 'Verify Payment Status Now'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleInitiate} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Choose Payment Gateway
                </label>

                <button
                  type="button"
                  onClick={() => setGateway('paynow')}
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    gateway === 'paynow'
                      ? isBurgundy
                        ? 'border-rose-900 bg-rose-50/50 ring-1 ring-rose-900'
                        : 'border-emerald-700 bg-emerald-50/50 ring-1 ring-emerald-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-5 h-5 text-slate-700 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">Paynow Zimbabwe</p>
                      <p className="text-xs text-slate-500">
                        EcoCash, OneMoney, Zimswitch, Visa / Mastercard
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                    {capabilities?.paynowConfigured ? 'Instant' : 'Setup Needed'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setGateway('paypal')}
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    gateway === 'paypal'
                      ? isBurgundy
                        ? 'border-rose-900 bg-rose-50/50 ring-1 ring-rose-900'
                        : 'border-emerald-700 bg-emerald-50/50 ring-1 ring-emerald-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-slate-700 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">PayPal (USD)</p>
                      <p className="text-xs text-slate-500">
                        International PayPal account or debit/credit card
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                    {capabilities?.paypalConfigured ? 'Instant' : 'Setup Needed'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setGateway('manual')}
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    gateway === 'manual'
                      ? isBurgundy
                        ? 'border-rose-900 bg-rose-50/50 ring-1 ring-rose-900'
                        : 'border-emerald-700 bg-emerald-50/50 ring-1 ring-emerald-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-slate-700 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        EcoCash / InnBucks / Bank Reference
                      </p>
                      <p className="text-xs text-slate-500">
                        Submit transfer reference for admin verification
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 shrink-0">Available</span>
                </button>
              </div>

              {gateway === 'manual' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  {paymentInstructions && (
                    <p className="text-xs text-slate-600 leading-relaxed">{paymentInstructions}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Method Used
                      </label>
                      <select
                        value={manualMethod}
                        onChange={(e) => setManualMethod(e.target.value)}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 bg-white text-sm"
                      >
                        <option value="EcoCash">EcoCash</option>
                        <option value="InnBucks">InnBucks</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Transaction Reference
                      </label>
                      <input
                        type="text"
                        required
                        value={manualReference}
                        onChange={(e) => setManualReference(e.target.value)}
                        placeholder="e.g. MP260412.1432.A91"
                        className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 bg-white text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Verified server-side before activating access. No card data is stored here.</span>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className={`w-full min-h-[46px] rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 ${primaryBtn}`}
              >
                {submitting
                  ? 'Processing...'
                  : gateway === 'manual'
                    ? `Submit $${amountUsd} Reference`
                    : `Pay $${amountUsd} USD via ${gateway === 'paynow' ? 'Paynow' : 'PayPal'}`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
