import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Briefcase,
  Camera,
  Check,
  CheckCheck,
  Clock,
  Eye,
  EyeOff,
  Heart,
  Home,
  Layers,
  LogOut,
  Megaphone,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  HouseListing,
  JobListing,
  MarketListing,
  PaymentCapabilities,
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
import { PaymentCheckoutModal } from './PaymentCheckoutModal';
import type { EditTarget } from './PostModal';

export type AccountModalTab = 'profile' | 'listings' | 'notifications';
type AuthMode = 'signin' | 'signup';
type OnboardingStep = 'details' | 'photo' | 'verify' | null;

interface AuthProfileModalProps {
  isOpen: boolean;
  initialTab?: AccountModalTab;
  promptMessage?: string;
  sponsorshipPlans: SponsorshipPlan[];
  paymentCapabilities?: PaymentCapabilities;
  paymentInstructions: string;
  onClose: () => void;
  onAuthSuccess?: () => void;
  onEditListing?: (target: EditTarget) => void;
  onListingChanged?: () => void;
  onOpenSingles?: () => void;
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

function OnboardingStepper({ current }: { current: Exclude<OnboardingStep, null> }) {
  const steps: Array<{ id: Exclude<OnboardingStep, null>; num: number; label: string }> = [
    { id: 'details', num: 1, label: 'Details' },
    { id: 'photo', num: 2, label: 'Profile Photo' },
    { id: 'verify', num: 3, label: 'Verification' },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="grid grid-cols-3 gap-2 pb-1" aria-label="Account setup steps">
      {steps.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div
            key={step.id}
            className={`px-2.5 py-2 rounded-lg border text-xs flex items-center gap-2 ${
              active
                ? 'border-emerald-700 bg-emerald-50/70 text-emerald-950 font-semibold'
                : done
                  ? 'border-emerald-200 bg-emerald-50/30 text-emerald-800 font-medium'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                active
                  ? 'bg-emerald-700 text-white'
                  : done
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-600'
              }`}
            >
              {done ? <Check className="w-3 h-3" aria-hidden="true" /> : step.num}
            </span>
            <span className="truncate">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AuthProfileModal({
  isOpen,
  initialTab = 'profile',
  promptMessage,
  sponsorshipPlans,
  paymentCapabilities,
  paymentInstructions,
  onClose,
  onAuthSuccess,
  onEditListing,
  onListingChanged,
  onOpenSingles,
}: AuthProfileModalProps) {
  const {
    user,
    notifications,
    unreadCount,
    signInWithGoogle,
    registerAccount,
    signInWithCredentials,
    refreshProfile,
    updateUser,
    markNotificationsRead,
    logout,
    authHeaders,
  } = useAuth();

  const [tab, setTab] = useState<AccountModalTab>(initialTab);
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Sign In fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Sign Up / Profile fields
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [city, setCity] = useState('Harare');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [datingOptIn, setDatingOptIn] = useState<'unset' | 'yes' | 'no'>('unset');
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setOnboardingStep(null);
      return;
    }
    setTab(initialTab);
    setError('');
    setSuccessMsg('');
    setAvatarInfo('');
    setSponsorTarget(null);
    setCheckoutOpen(false);
    setConfirmDelete(null);
    if (sponsorshipPlans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(sponsorshipPlans[0].id);
    }
    if (!user) {
      setAuthMode('signin');
      setLoginIdentifier('');
      setLoginPassword('');
      setSignupEmail('');
      setSignupPassword('');
      setFullName('');
      setPhone('');
      setWhatsapp('');
      setCity('Harare');
      setAvatar(null);
      setDatingOptIn('unset');
    }
    // Only reset modal UI state when opening/closing or switching initial tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || !user) return;
    setFullName(user.fullName);
    setPhone(user.phone);
    setWhatsapp(user.whatsapp || user.phone);
    setCity(user.city || 'Harare');
    setAvatar(user.avatar);
    setDatingOptIn(user.datingOptIn ?? 'unset');
  }, [isOpen, user]);

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
    if (isOpen && user && tab === 'listings' && !onboardingStep) {
      loadMyListings();
    }
  }, [isOpen, user, tab, onboardingStep, loadMyListings]);

  if (!isOpen) return null;

  const handleCredentialSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!loginIdentifier.trim() || !loginPassword) {
      setError('Please enter your email or phone number and password.');
      return;
    }

    setSigningIn(true);
    try {
      const profile = await signInWithCredentials(loginIdentifier.trim(), loginPassword);
      if (isValidZimbabwePhone(profile.whatsapp)) {
        onAuthSuccess?.();
        onClose();
      } else {
        setOnboardingStep('details');
        setSuccessMsg('Signed in! Please complete your profile details.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleStage1Register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (fullName.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const targetWa = whatsapp.trim() || phone.trim();
    if (!isValidZimbabwePhone(phone) || !isValidZimbabwePhone(targetWa)) {
      setError('Enter valid Zimbabwe phone and WhatsApp numbers (e.g. 0771234567).');
      return;
    }

    setSubmitting(true);
    try {
      await registerAccount({
        fullName: fullName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
        phone: phone.trim(),
        whatsapp: targetWa,
        city,
        datingOptIn,
      });
      setOnboardingStep('photo');
      setSuccessMsg('Account created! Next, upload your profile photo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccessMsg('');
    setSigningIn(true);
    try {
      const profile = await signInWithGoogle();
      if (!profile) return;
      if (!isValidZimbabwePhone(profile.whatsapp)) {
        setOnboardingStep('details');
        setSuccessMsg('Signed in with Google! Complete your Zimbabwe phone, WhatsApp, and city below.');
      } else if (authMode === 'signup' && !profile.avatar) {
        setOnboardingStep('photo');
        setSuccessMsg('Account connected! Upload a profile photo or continue.');
      } else {
        onAuthSuccess?.();
        onClose();
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

  const handleSaveProfile = async (
    e: React.FormEvent,
    options?: { advanceTo?: OnboardingStep; closeOnSuccess?: boolean }
  ) => {
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
          datingOptIn,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update profile.');
        return;
      }
      updateUser(data.user);
      if (options?.advanceTo) {
        setOnboardingStep(options.advanceTo);
        setSuccessMsg(
          options.advanceTo === 'photo'
            ? 'Details saved! Now upload your profile photo.'
            : 'Profile photo saved! You can request verification below or start right away.'
        );
      } else {
        setSuccessMsg('Profile saved.');
        onAuthSuccess?.();
        if (options?.closeOnSuccess) {
          onClose();
        }
      }
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

  const handleFinishOnboarding = () => {
    setOnboardingStep(null);
    onAuthSuccess?.();
    onClose();
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

  const totalMyAds = myJobs.length + myMarket.length + myHouses.length;
  const activeSponsorPlan =
    sponsorshipPlans.find((p) => p.id === selectedPlanId) ?? sponsorshipPlans[0] ?? null;

  const modalTitle = !user
    ? authMode === 'signin'
      ? 'Sign In to MARKET & JOBS'
      : 'Create Account — Step 1 of 3'
    : onboardingStep === 'details'
      ? 'Complete Your Details — Step 1 of 3'
      : onboardingStep === 'photo'
        ? 'Upload Profile Photo — Step 2 of 3'
        : onboardingStep === 'verify'
          ? 'Verification & All Tabs Ready — Step 3 of 3'
          : 'Your Account';

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
            <h2 className="text-base font-bold text-slate-900">{modalTitle}</h2>
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

        {/* Account Navigation Tabs (only when signed in and not inside active onboarding steps) */}
        {user && !onboardingStep && (
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
            <div className="space-y-4">
              {/* Sign In / Sign Up Switcher */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setError('');
                    setSuccessMsg('');
                  }}
                  className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                    authMode === 'signin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setError('');
                    setSuccessMsg('');
                  }}
                  className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                    authMode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              {authMode === 'signin' ? (
                <form onSubmit={handleCredentialSignIn} className="space-y-3.5">
                  <p className="text-xs sm:text-sm text-slate-600">
                    Sign in to access all four tabs: <strong>Jobs</strong>, <strong>Market</strong>,{' '}
                    <strong>Houses</strong>, and <strong>Singles</strong>.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Email or Zimbabwe Phone Number
                    </label>
                    <input
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="you@example.com or 0771234567"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showLoginPw ? 'text' : 'password'}
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full min-h-[44px] pl-3.5 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPw((v) => !v)}
                        aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-800"
                      >
                        {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={signingIn}
                    className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    {signingIn ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStage1Register} className="space-y-3.5">
                  <OnboardingStepper current="details" />
                  <p className="text-xs text-slate-600">
                    Step 1: Fill in your details. Next you will upload a profile photo, and finally you can request verification after everything is ready.
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Tatenda Moyo"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
                      <input
                        type="email"
                        required
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        placeholder="tatenda@example.co.zw"
                        className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Password (6+ chars)
                      </label>
                      <div className="relative">
                        <input
                          type={showSignupPw ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          placeholder="Create a password"
                          className="w-full min-h-[44px] pl-3.5 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSignupPw((v) => !v)}
                          aria-label={showSignupPw ? 'Hide password' : 'Show password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-800"
                        >
                          {showSignupPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
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
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        WhatsApp Number
                      </label>
                      <input
                        type="tel"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        placeholder="Same as phone or 077..."
                        className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>
                  {(whatsapp || phone) && (
                    <p className="text-xs text-slate-500 tabular-nums -mt-1">
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

                  <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-200 space-y-2">
                    <div className="flex items-start gap-2">
                      <Heart className="w-4 h-4 text-rose-900 mt-0.5 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Would you also like to join the Dating section and meet singles?
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          Optional · Adults 18+ only · You can use all tabs either way
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDatingOptIn('yes')}
                        className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold transition-colors ${
                          datingOptIn === 'yes'
                            ? 'bg-rose-900 text-white border-rose-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50'
                        }`}
                      >
                        Yes (18+)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDatingOptIn('no')}
                        className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold transition-colors ${
                          datingOptIn === 'no'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Creating Account...' : 'Create Account & Upload Profile Photo'}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </form>
              )}

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200" />
                <span className="shrink mx-3 text-xs font-medium text-slate-400 uppercase">or</span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              <button
                type="button"
                disabled={signingIn || submitting}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[46px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
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
          ) : onboardingStep === 'details' ? (
            <form
              onSubmit={(e) => handleSaveProfile(e, { advanceTo: 'photo' })}
              className="space-y-4"
            >
              <OnboardingStepper current="details" />
              <p className="text-xs text-slate-600">
                Complete your Zimbabwe contact details so employers, buyers, landlords, and singles can reach you on WhatsApp.
              </p>

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

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {submitting ? 'Saving Details...' : 'Save Details & Upload Profile Photo'}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </form>
          ) : onboardingStep === 'photo' ? (
            <form
              onSubmit={(e) => handleSaveProfile(e, { advanceTo: 'verify' })}
              className="space-y-5"
            >
              <OnboardingStepper current="photo" />

              <div className="text-center space-y-2 pt-1">
                <div className="w-24 h-24 mx-auto rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                  {avatar ? (
                    <img src={avatar} alt={fullName} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-10 h-10 text-slate-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Upload Your Profile Picture</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Photos are automatically compressed to save Zimbabwe mobile data.
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <label className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 cursor-pointer">
                  <Camera className="w-4 h-4" aria-hidden="true" />
                  {avatar ? 'Choose Different Photo' : 'Select Profile Photo'}
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
                </label>
                {avatarInfo && <p className="text-xs text-emerald-700 font-medium">{avatarInfo}</p>}
                {avatar && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatar(null);
                      setAvatarInfo('');
                    }}
                    className="text-xs text-slate-500 hover:text-red-600"
                  >
                    Remove photo
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  {submitting
                    ? 'Saving Profile...'
                    : avatar
                      ? 'Save Photo & Continue to Verification'
                      : 'Continue to Verification'}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setOnboardingStep('verify');
                  }}
                  className="w-full min-h-[40px] rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                >
                  Skip photo for now
                </button>
              </div>
            </form>
          ) : onboardingStep === 'verify' ? (
            <div className="space-y-4">
              <OnboardingStepper current="verify" />

              {/* Account Summary */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.fullName} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-6 h-6 text-slate-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 truncate">{user.fullName}</p>
                  <p className="text-xs text-slate-600 truncate">
                    {user.city} · {formatZimbabwePhoneDisplay(user.whatsapp)}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                </div>
              </div>

              {/* All 4 Tabs Ready Notice */}
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2.5">
                <p className="text-xs font-bold text-emerald-950">
                  Your account is active across all 4 tabs right now:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-emerald-900">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Briefcase className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Jobs: Post &amp; Apply
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <ShoppingBag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Market: Buy &amp; Sell
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Home className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Houses: List &amp; Rent
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Heart className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Singles: Join &amp; Connect
                  </span>
                </div>
              </div>

              {/* Late Verification Request Card */}
              <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Request Account Verification</h3>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Now that your details and profile are set up, you can request a Verified Member badge so employers, buyers, landlords, and singles trust your profile faster.
                    </p>
                  </div>
                </div>

                {user.verificationStatus === 'verified' ? (
                  <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5">
                    <BadgeCheck className="w-4 h-4" aria-hidden="true" />
                    Verified Zimbabwe Member
                  </div>
                ) : user.verificationStatus === 'pending' ? (
                  <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 inline-flex items-center gap-1.5">
                    <Clock className="w-4 h-4" aria-hidden="true" />
                    Verification Request Submitted (Pending Admin Review)
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={verifyingReq}
                    onClick={handleRequestVerification}
                    className="w-full min-h-[42px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold disabled:opacity-60"
                  >
                    {verifyingReq ? 'Submitting Request...' : 'Request Verification Now'}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleFinishOnboarding}
                className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                Start Using All Tabs
              </button>
            </div>
          ) : tab === 'profile' ? (
            <form onSubmit={(e) => handleSaveProfile(e)} className="space-y-4">
              {/* Account Setup Progress Strip */}
              <div className="grid grid-cols-3 gap-2">
                <div className="px-2.5 py-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-[11px] font-semibold text-emerald-900 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">1. Details</span>
                </div>
                <div
                  className={`px-2.5 py-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${
                    avatar
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {avatar ? (
                    <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">2. Photo</span>
                </div>
                <div
                  className={`px-2.5 py-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${
                    user.verificationStatus === 'verified'
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : user.verificationStatus === 'pending'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  {user.verificationStatus === 'verified' ? (
                    <BadgeCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    3. {user.verificationStatus === 'verified' ? 'Verified' : user.verificationStatus === 'pending' ? 'Pending' : 'Verify'}
                  </span>
                </div>
              </div>

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
                    <p className="text-sm font-semibold text-slate-700">Unverified Account (All 4 tabs active)</p>
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

              {/* Optional Dating / Singles Opt-In Question */}
              <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200 space-y-2.5">
                <div className="flex items-start gap-2">
                  <Heart className="w-4 h-4 text-rose-900 mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      Would you also like to join the Dating section and meet singles?
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Optional · Adults 18+ only · Opposite-gender private matching
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDatingOptIn('yes')}
                    className={`min-h-[38px] px-3 rounded-lg border text-xs font-semibold transition-colors ${
                      datingOptIn === 'yes'
                        ? 'bg-rose-900 text-white border-rose-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50'
                    }`}
                  >
                    Yes (18+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDatingOptIn('no')}
                    className={`min-h-[38px] px-3 rounded-lg border text-xs font-semibold transition-colors ${
                      datingOptIn === 'no'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    No
                  </button>
                </div>
                {datingOptIn === 'yes' && onOpenSingles && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSingles();
                    }}
                    className="text-xs font-semibold text-rose-900 hover:underline"
                  >
                    Open Singles section to set up your 18+ dating profile &rarr;
                  </button>
                )}
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
              {/* Inline Sponsorship Plan Selector -> Opens Central Checkout */}
              {sponsorTarget && (
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Sponsor &ldquo;{sponsorTarget.title}&rdquo;
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Boost this listing above regular posts with a SPONSORED badge. Pay securely via Paynow Zimbabwe, PayPal, or EcoCash/InnBucks.
                      </p>
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
                      const active = (selectedPlanId || sponsorshipPlans[0]?.id) === plan.id;
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

                  <button
                    type="button"
                    disabled={!activeSponsorPlan}
                    onClick={() => setCheckoutOpen(true)}
                    className="w-full min-h-[42px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    Proceed to Secure Payment ({activeSponsorPlan ? `$${activeSponsorPlan.priceUsd} USD` : ''})
                  </button>
                </div>
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

      {sponsorTarget && activeSponsorPlan && (
        <PaymentCheckoutModal
          isOpen={checkoutOpen}
          featureType={
            sponsorTarget.listingType === 'job'
              ? 'sponsored_job'
              : sponsorTarget.listingType === 'market'
                ? 'sponsored_market'
                : 'sponsored_house'
          }
          targetId={sponsorTarget.listingId}
          planOrPackageId={activeSponsorPlan.id}
          itemTitle={`${sponsorTarget.title} (${activeSponsorPlan.name})`}
          amountUsd={activeSponsorPlan.priceUsd}
          subtitle={`${activeSponsorPlan.durationDays}-day featured placement on MARKET & JOBS`}
          capabilities={paymentCapabilities}
          paymentInstructions={paymentInstructions}
          accent="emerald"
          onClose={() => setCheckoutOpen(false)}
          onSuccess={(msg) => {
            setCheckoutOpen(false);
            setSponsorTarget(null);
            setSuccessMsg(msg);
            loadMyListings();
            onListingChanged?.();
          }}
        />
      )}
    </div>
  );
}
