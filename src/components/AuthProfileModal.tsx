import React, { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  Camera,
  CheckCheck,
  Clock,
  Layers,
  LogOut,
  Megaphone,
  Pencil,
  ShieldAlert,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  HouseListing,
  JobListing,
  MarketListing,
  SponsorshipPayment,
  SponsorshipPlan,
} from '../types';
import { ZIMBABWE_LOCATIONS } from '../types';
import { compressImageFile } from '../utils/imageCompression';
import {
  formatShortDate,
  formatTimeAgo,
  formatZimbabwePhoneDisplay,
  isValidZimbabwePhone,
  normalizeZimbabwePhone,
} from '../utils/whatsapp';
import type { EditTarget } from './PostModal';

export type AccountModalTab = 'profile' | 'listings' | 'notifications';

interface AuthProfileModalProps {
  isOpen: boolean;
  initialTab?: AccountModalTab;
  promptMessage?: string;
  sponsorshipPlans: SponsorshipPlan[];
  paymentInstructions: string;
  onClose: () => void;
  onAuthSuccess?: () => void;
  onEditListing?: (target: EditTarget) => void;
  onListingChanged?: () => void;
}

const APPROVAL_LABELS: Record<string, { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
  pending: { label: 'Pending Approval', className: 'text-amber-800 bg-amber-50 border-amber-200' },
  rejected: { label: 'Rejected', className: 'text-red-700 bg-red-50 border-red-200' },
  correction_requested: {
    label: 'Corrections Requested',
    className: 'text-amber-900 bg-amber-100 border-amber-300',
  },
};

export function AuthProfileModal({
  isOpen,
  initialTab = 'profile',
  promptMessage,
  sponsorshipPlans,
  paymentInstructions,
  onClose,
  onAuthSuccess,
  onEditListing,
  onListingChanged,
}: AuthProfileModalProps) {
  const {
    user,
    notifications,
    unreadCount,
    signInWithGoogle,
    refreshProfile,
    updateUser,
    markNotificationsRead,
    logout,
    authHeaders,
  } = useAuth();

  const [tab, setTab] = useState<AccountModalTab>(initialTab);
  const [signingIn, setSigningIn] = useState(false);

  // Profile fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [city, setCity] = useState('Harare');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarInfo, setAvatarInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifyingReq, setVerifyingReq] = useState(false);

  // My listings & sponsorship state
  const [listingsLoading, setListingsLoading] = useState(false);
  const [myJobs, setMyJobs] = useState<JobListing[]>([]);
  const [myMarket, setMyMarket] = useState<MarketListing[]>([]);
  const [myHouses, setMyHouses] = useState<HouseListing[]>([]);
  const [myPayments, setMyPayments] = useState<SponsorshipPayment[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Sponsorship request drawer
  const [sponsorTarget, setSponsorTarget] = useState<{
    listingType: 'job' | 'market' | 'house';
    listingId: number;
    title: string;
  } | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number>(sponsorshipPlans[0]?.id ?? 0);
  const [paymentMethod, setPaymentMethod] = useState('EcoCash');
  const [paymentReference, setPaymentReference] = useState('');
  const [sponsorSubmitting, setSponsorSubmitting] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    setError('');
    setSuccessMsg('');
    setAvatarInfo('');
    setSponsorTarget(null);
    setConfirmDelete(null);
    if (sponsorshipPlans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(sponsorshipPlans[0].id);
    }
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone);
      setWhatsapp(user.whatsapp || user.phone);
      setCity(user.city || 'Harare');
      setAvatar(user.avatar);
    }
  }, [isOpen, initialTab, user, sponsorshipPlans, selectedPlanId]);

  const loadMyListings = useCallback(async () => {
    if (!user) return;
    setListingsLoading(true);
    try {
      const res = await fetch('/api/my-listings', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setMyJobs(data.jobs ?? []);
        setMyMarket(data.market ?? []);
        setMyHouses(data.houses ?? []);
        setMyPayments(data.sponsorshipPayments ?? []);
      }
    } catch {
      setError('Could not load your listings.');
    } finally {
      setListingsLoading(false);
    }
  }, [user, authHeaders]);

  useEffect(() => {
    if (isOpen && user && tab === 'listings') {
      loadMyListings();
    }
  }, [isOpen, user, tab, loadMyListings]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setError('');
    setSigningIn(true);
    try {
      const profile = await signInWithGoogle();
      if (profile && isValidZimbabwePhone(profile.whatsapp)) {
        onAuthSuccess?.();
        onClose();
      } else {
        setSuccessMsg('Signed in! Please complete your Zimbabwe phone, WhatsApp, and city below.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const { dataUrl, sizeKb } = await compressImageFile(file, {
        maxDimension: 320,
        quality: 0.72,
      });
      setAvatar(dataUrl);
      setAvatarInfo(`Compressed to ${sizeKb} KB`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process profile picture.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (fullName.trim().length < 2) {
      setError('Full name is required.');
      return;
    }
    const targetWa = whatsapp.trim() || phone.trim();
    if (!isValidZimbabwePhone(phone) || !isValidZimbabwePhone(targetWa)) {
      setError('Enter valid Zimbabwe phone and WhatsApp numbers (e.g. 0771234567).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone,
          whatsapp: targetWa,
          city,
          avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update profile.');
        return;
      }
      updateUser(data.user);
      setSuccessMsg('Profile saved.');
      onAuthSuccess?.();
    } catch {
      setError('Network error while saving profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestVerification = async () => {
    setError('');
    setSuccessMsg('');
    setVerifyingReq(true);
    try {
      const res = await fetch('/api/auth/request-verification', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not request verification.');
        return;
      }
      updateUser(data.user);
      setSuccessMsg('Verification request submitted! An administrator will review your profile.');
    } catch {
      setError('Network error requesting verification.');
    } finally {
      setVerifyingReq(false);
    }
  };

  const handleLifecycleChange = async (
    listingType: 'job' | 'market' | 'house',
    id: number,
    lifecycleStatus: string
  ) => {
    setError('');
    const res = await fetch(`/api/my-listings/${listingType}/${id}/lifecycle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ lifecycleStatus }),
    });
    if (res.ok) {
      loadMyListings();
      onListingChanged?.();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to update status.');
    }
  };

  const handleDeleteOwn = async (listingType: 'job' | 'market' | 'house', id: number) => {
    const endpoint =
      listingType === 'job'
        ? `/api/jobs/${id}`
        : listingType === 'market'
          ? `/api/market/${id}`
          : `/api/houses/${id}`;
    const res = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      setConfirmDelete(null);
      loadMyListings();
      onListingChanged?.();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not delete listing.');
    }
  };

  const handleSubmitSponsorship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sponsorTarget) return;
    setError('');
    setSuccessMsg('');
    const planId = selectedPlanId || sponsorshipPlans[0]?.id;
    if (!planId) {
      setError('No sponsorship plans are currently active.');
      return;
    }
    if (paymentReference.trim().length < 3) {
      setError('Enter the transaction reference from your payment.');
      return;
    }

    setSponsorSubmitting(true);
    try {
      const res = await fetch('/api/sponsorships/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          listingType: sponsorTarget.listingType,
          listingId: sponsorTarget.listingId,
          planId,
          paymentMethod,
          paymentReference: paymentReference.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not submit sponsorship request.');
        return;
      }
      setSponsorTarget(null);
      setPaymentReference('');
      setSuccessMsg(
        'Sponsorship payment reference submitted! An administrator will confirm your payment to activate SPONSORED placement.'
      );
      loadMyListings();
    } catch {
      setError('Network error submitting sponsorship.');
    } finally {
      setSponsorSubmitting(false);
    }
  };

  const totalMyAds = myJobs.length + myMarket.length + myHouses.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">
              {user ? 'Your Account' : 'Sign In to MARKET & JOBS'}
            </h2>
            {user?.verificationStatus === 'verified' && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Verified
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Account Navigation Tabs (when signed in) */}
        {user && (
          <div className="px-5 pt-2.5 border-b border-slate-200 flex items-center gap-4 overflow-x-auto">
            <button
              type="button"
              onClick={() => {
                setTab('profile');
                setError('');
              }}
              className={`pb-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                tab === 'profile'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <UserIcon className="w-4 h-4" aria-hidden="true" />
              Profile &amp; Verification
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('listings');
                setError('');
              }}
              className={`pb-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                tab === 'listings'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
              My Ads &amp; Sponsor
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('notifications');
                setError('');
                refreshProfile();
              }}
              className={`pb-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                tab === 'notifications'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              Notifications
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-600 text-white tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        )}

        <div className="overflow-y-auto p-5 space-y-4">
          {promptMessage && !user && (
            <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {promptMessage}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5" role="alert">
              {error}
            </p>
          )}

          {successMsg && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {successMsg}
            </p>
          )}

          {!user ? (
            <div className="py-3 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Sign in securely with Google to publish Jobs, Market products &amp; services, or Houses for rent across Zimbabwe. You can save your +263 WhatsApp number, track post approvals, request verification, and sponsor listings.
              </p>
              <button
                type="button"
                disabled={signingIn}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[48px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                {signingIn ? 'Connecting to Google...' : 'Continue with Google'}
              </button>
            </div>
          ) : tab === 'profile' ? (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  {avatar ? (
                    <img src={avatar} alt={fullName} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-7 h-7 text-slate-400" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer">
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    {avatar ? 'Change Photo' : 'Add Profile Photo'}
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
                  </label>
                  {avatar && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatar(null);
                        setAvatarInfo('');
                      }}
                      className="block text-xs text-slate-500 hover:text-red-600"
                    >
                      Remove photo
                    </button>
                  )}
                  {avatarInfo && <p className="text-xs text-slate-500">{avatarInfo}</p>}
                </div>
              </div>

              {/* Verification Status Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Verification Status
                  </p>
                  {user.verificationStatus === 'verified' ? (
                    <p className="text-sm font-semibold text-emerald-800 inline-flex items-center gap-1.5">
                      <BadgeCheck className="w-4 h-4" aria-hidden="true" />
                      Verified Zimbabwe Member
                    </p>
                  ) : user.verificationStatus === 'pending' ? (
                    <p className="text-sm font-semibold text-amber-800 inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4" aria-hidden="true" />
                      Pending Admin Verification
                    </p>
                  ) : user.verificationStatus === 'suspended' ? (
                    <p className="text-sm font-semibold text-red-700 inline-flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                      Suspended
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-slate-700">Unverified Account</p>
                  )}
                  {user.verificationNote && (
                    <p className="text-xs text-slate-600">{user.verificationNote}</p>
                  )}
                </div>

                {user.verificationStatus === 'unverified' && (
                  <button
                    type="button"
                    disabled={verifyingReq}
                    onClick={handleRequestVerification}
                    className="min-h-[38px] px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60 whitespace-nowrap"
                  >
                    {verifyingReq ? 'Submitting...' : 'Request Verification'}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Phone Number</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0771234567"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">WhatsApp Number</label>
                  <input
                    type="tel"
                    required
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="0771234567"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>
              {(whatsapp || phone) && (
                <p className="text-xs text-slate-500 tabular-nums -mt-2">
                  Click-to-chat format: {formatZimbabwePhoneDisplay(normalizeZimbabwePhone(whatsapp || phone))}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Location</label>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                >
                  {ZIMBABWE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[46px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Profile'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    onClose();
                  }}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-700"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            </form>
          ) : tab === 'listings' ? (
            <div className="space-y-5">
              {/* Inline Sponsorship Payment Submission Drawer */}
              {sponsorTarget && (
                <form
                  onSubmit={handleSubmitSponsorship}
                  className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Sponsor &ldquo;{sponsorTarget.title}&rdquo;
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">{paymentInstructions}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSponsorTarget(null)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                    >
                      Close
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {sponsorshipPlans.map((plan) => {
                      const active = selectedPlanId === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`p-2.5 rounded-lg border text-left transition-colors ${
                            active
                              ? 'border-emerald-700 bg-white ring-1 ring-emerald-700'
                              : 'border-slate-200 bg-white/80 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900">{plan.name}</div>
                          <div className="text-xs font-semibold text-emerald-800 tabular-nums mt-0.5">
                            ${plan.priceUsd} USD · {plan.durationDays}d
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Payment Method
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                      >
                        <option value="EcoCash">EcoCash</option>
                        <option value="InnBucks">InnBucks</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Payment Reference
                      </label>
                      <input
                        type="text"
                        required
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        placeholder="e.g. MP260412.1432.A91"
                        className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={sponsorSubmitting}
                    className="w-full min-h-[42px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {sponsorSubmitting ? 'Submitting Payment...' : 'Submit Payment Reference for Verification'}
                  </button>
                </form>
              )}

              {listingsLoading ? (
                <p className="text-sm text-slate-500 py-6 text-center">Loading your advertisements...</p>
              ) : totalMyAds === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  You haven&apos;t posted any Jobs, Market items, or Houses yet. Tap <strong>+ POST</strong> to submit your first ad.
                </p>
              ) : (
                <div className="space-y-3">
                  {[
                    ...myJobs.map((j) => ({ kind: 'job' as const, item: j })),
                    ...myMarket.map((m) => ({ kind: 'market' as const, item: m })),
                    ...myHouses.map((h) => ({ kind: 'house' as const, item: h })),
                  ].map(({ kind, item }) => {
                    const badge = APPROVAL_LABELS[item.approvalStatus] ?? APPROVAL_LABELS.pending;
                    const closedVal = kind === 'job' ? 'filled' : kind === 'market' ? 'sold' : 'rented';
                    const isClosed = item.lifecycleStatus === closedVal;
                    const delKey = `${kind}:${item.id}`;

                    return (
                      <div key={delKey} className="p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {kind}
                              </span>
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              {item.isSponsored && (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                                  SPONSORED{item.sponsoredUntil ? ` until ${formatShortDate(item.sponsoredUntil)}` : ''}
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Posted {formatTimeAgo(item.createdAt)} · Status:{' '}
                              <strong className="text-slate-700 capitalize">{item.lifecycleStatus}</strong>
                            </p>
                          </div>
                        </div>

                        {item.moderationReason && (
                          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                            <strong>Admin note:</strong> {item.moderationReason}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {onEditListing && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                if (kind === 'job') onEditListing({ type: 'job', item: item as JobListing });
                                else if (kind === 'market')
                                  onEditListing({ type: 'market', item: item as MarketListing });
                                else onEditListing({ type: 'house', item: item as HouseListing });
                              }}
                              className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              Edit
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleLifecycleChange(kind, item.id, isClosed ? 'active' : closedVal)
                            }
                            className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
                          >
                            {isClosed ? 'Mark Active' : `Mark ${closedVal}`}
                          </button>

                          {!item.isSponsored && sponsorshipPlans.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setSponsorTarget({
                                  listingType: kind,
                                  listingId: item.id,
                                  title: item.title,
                                })
                              }
                              className="min-h-[34px] px-2.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
                              Sponsor
                            </button>
                          )}

                          {confirmDelete === delKey ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteOwn(kind, item.id)}
                              className="min-h-[34px] px-2.5 rounded-md bg-red-600 text-white text-xs font-semibold ml-auto"
                            >
                              Confirm Delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(delKey)}
                              className="min-h-[34px] px-2.5 rounded-md text-red-600 hover:bg-red-50 text-xs font-medium inline-flex items-center gap-1 ml-auto"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {myPayments.length > 0 && (
                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Sponsorship Payment Requests
                  </h3>
                  <div className="space-y-2">
                    {myPayments.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{p.listingTitle}</p>
                          <p className="text-slate-500 tabular-nums">
                            {p.paymentMethod} · Ref: {p.paymentReference} · ${p.amountUsd} ({p.durationDays}d)
                          </p>
                          {p.adminNote && <p className="text-slate-600 mt-0.5">{p.adminNote}</p>}
                        </div>
                        <span
                          className={`font-semibold uppercase text-[11px] shrink-0 ${
                            p.status === 'confirmed'
                              ? 'text-emerald-700'
                              : p.status === 'rejected'
                                ? 'text-red-600'
                                : p.status === 'expired'
                                  ? 'text-slate-500'
                                  : 'text-amber-700'
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">
                  Recent moderation, verification, and sponsorship updates
                </p>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markNotificationsRead}
                    className="text-xs font-semibold text-emerald-800 hover:underline inline-flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No notifications yet.</p>
              ) : (
                <div className="space-y-2">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3.5 rounded-xl border space-y-1 ${
                        n.isRead ? 'bg-white border-slate-200' : 'bg-emerald-50/50 border-emerald-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">{n.title}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {formatTimeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
