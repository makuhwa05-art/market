import React, { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  Camera,
  CheckCircle2,
  Crown,
  Flag,
  Heart,
  Lock,
  MapPin,
  MessageCircle,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  DatingPackage,
  DatingProfilePrivate,
  DatingProfilePublic,
  DatingSelectionItem,
  DatingSubscription,
  PaymentCapabilities,
} from '../types';
import {
  DATING_COUNTRIES,
  HIV_STATUS_OPTIONS,
  RELATIONSHIP_INTENTIONS,
  ZIMBABWE_LOCATIONS,
} from '../types';
import { resolveAssetUrl } from '../utils/assetResolver';
import { compressImageFile } from '../utils/imageCompression';
import { buildDirectWhatsAppUrl, formatShortDate } from '../utils/whatsapp';
import { PaymentCheckoutModal } from './PaymentCheckoutModal';

interface SinglesSectionProps {
  datingPackages: DatingPackage[];
  datingEnabled: boolean;
  allowHivDisclosure: boolean;
  paymentCapabilities?: PaymentCapabilities;
  paymentInstructions: string;
  onRequireAuth: () => void;
}

const INTENTION_LABEL: Record<string, string> = {
  dating: 'Dating',
  serious_relationship: 'Serious Relationship',
  marriage: 'Marriage',
};

export function SinglesSection({
  datingPackages,
  datingEnabled,
  allowHivDisclosure,
  paymentCapabilities,
  paymentInstructions,
  onRequireAuth,
}: SinglesSectionProps) {
  const { user, updateUser, authHeaders } = useAuth();

  // Member dating state
  const [loadingMe, setLoadingMe] = useState(false);
  const [myProfile, setMyProfile] = useState<DatingProfilePrivate | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<DatingSubscription | null>(null);
  const [mySelections, setMySelections] = useState<DatingSelectionItem[]>([]);
  const [optedInChoice, setOptedInChoice] = useState<'yes' | 'no' | 'unset'>(
    user?.datingOptIn ?? 'unset'
  );

  // Feed & filters
  const [profiles, setProfiles] = useState<DatingProfilePublic[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [countryFilter, setCountryFilter] = useState('All');
  const [cityFilter, setCityFilter] = useState('All');
  const [locationQuery, setLocationQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Views & modals
  const [editingProfile, setEditingProfile] = useState(false);
  const [showPackages, setShowPackages] = useState(false);
  const [showChosenList, setShowChosenList] = useState(false);
  const [checkoutPkg, setCheckoutPkg] = useState<DatingPackage | null>(null);
  const [reportTarget, setReportTarget] = useState<DatingProfilePublic | null>(null);
  const [reportReason, setReportReason] = useState('Fake or misleading profile');
  const [reportDetails, setReportDetails] = useState('');

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState('25');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [country, setCountry] = useState('Zimbabwe');
  const [city, setCity] = useState('Harare');
  const [suburb, setSuburb] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [photo, setPhoto] = useState('');
  const [childrenCount, setChildrenCount] = useState('');
  const [hivStatus, setHivStatus] = useState('Prefer not to disclose');
  const [shareHivWithSubscribers, setShareHivWithSubscribers] = useState(false);
  const [description, setDescription] = useState('');
  const [intention, setIntention] = useState<'dating' | 'serious_relationship' | 'marriage'>(
    'serious_relationship'
  );
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [savingProfile, setSavingProfile] = useState(false);
  const [choosingId, setChoosingId] = useState<number | null>(null);
  const [lastChosenResult, setLastChosenResult] = useState<{
    name: string;
    whatsapp: string;
    whatsappUrl: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (user?.datingOptIn) {
      setOptedInChoice(user.datingOptIn);
    }
  }, [user?.datingOptIn]);

  const loadDatingMe = useCallback(async () => {
    if (!user) {
      setMyProfile(null);
      setActiveSubscription(null);
      setMySelections([]);
      return;
    }
    setLoadingMe(true);
    try {
      const res = await fetch('/api/dating/me', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setMyProfile(data.profile ?? null);
        setActiveSubscription(data.activeSubscription ?? null);
        setMySelections(data.selections ?? []);
        if (data.profile) {
          const p = data.profile as DatingProfilePrivate;
          setDisplayName(p.displayName);
          setAge(String(p.age));
          setGender(p.gender);
          setCountry(p.country);
          setCity(p.city);
          setSuburb(p.suburb);
          setWhatsapp(p.whatsapp);
          setPhoto(p.photo);
          setChildrenCount(p.childrenCount !== null ? String(p.childrenCount) : '');
          setHivStatus(p.hivStatus);
          setShareHivWithSubscribers(p.shareHivWithSubscribers);
          setDescription(p.description);
          setIntention(p.intention);
          setTermsAccepted(p.termsAccepted);
        } else {
          setDisplayName(user.fullName.split(' ')[0] || '');
          setCity(user.city || 'Harare');
          setWhatsapp(user.whatsapp || user.phone || '');
          setPhoto(user.avatar || '');
        }
      }
    } catch {
      setError('Could not load your Singles profile.');
    } finally {
      setLoadingMe(false);
    }
  }, [user, authHeaders]);

  const loadProfilesFeed = useCallback(async () => {
    if (!user || !myProfile) {
      setProfiles([]);
      return;
    }
    setLoadingFeed(true);
    try {
      const params = new URLSearchParams();
      if (countryFilter !== 'All') params.set('country', countryFilter);
      if (cityFilter !== 'All') params.set('city', cityFilter);
      if (locationQuery.trim()) params.set('location', locationQuery.trim());
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await fetch(`/api/dating/profiles?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setProfiles(data.profiles ?? []);
        if (data.activeSubscription !== undefined) {
          setActiveSubscription(data.activeSubscription);
        }
      } else {
        setError(data.error || 'Could not load singles profiles.');
      }
    } catch {
      setError('Network error loading singles.');
    } finally {
      setLoadingFeed(false);
    }
  }, [user, myProfile, countryFilter, cityFilter, locationQuery, searchQuery, authHeaders]);

  useEffect(() => {
    loadDatingMe();
  }, [loadDatingMe]);

  useEffect(() => {
    if (!user || !myProfile) return;
    const t = setTimeout(() => {
      loadProfilesFeed();
    }, 150);
    return () => clearTimeout(t);
  }, [user, myProfile, loadProfilesFeed]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const { dataUrl } = await compressImageFile(file, {
        maxDimension: 640,
        quality: 0.78,
      });
      setPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process photo.');
    } finally {
      e.target.value = '';
    }
  };

  const handleOptInDecision = async (choice: 'yes' | 'no') => {
    setOptedInChoice(choice);
    if (!user) return;
    if (choice === 'no') {
      await fetch('/api/dating/profile', {
        method: 'DELETE',
        headers: authHeaders(),
      }).catch(() => {});
      updateUser({ ...user, datingOptIn: 'no' });
      setMyProfile(null);
      setNotice('You have opted out of the Singles section. You can join anytime.');
    } else {
      updateUser({ ...user, datingOptIn: 'yes' });
      setEditingProfile(true);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const numAge = Number(age);
    if (!Number.isInteger(numAge) || numAge < 18) {
      setError('You must be 18 years or older to join the Singles section.');
      return;
    }
    if (!termsAccepted) {
      setError('Please accept the Dating Safety & Privacy Terms.');
      return;
    }
    if (!photo) {
      setError('Please upload a clear profile photo.');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch('/api/dating/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          age: numAge,
          gender,
          country,
          city,
          suburb: suburb.trim(),
          whatsapp: whatsapp.trim(),
          photo,
          childrenCount: childrenCount === '' ? null : Number(childrenCount),
          hivStatus,
          shareHivWithSubscribers:
            hivStatus === 'Prefer not to disclose' ? false : shareHivWithSubscribers,
          description: description.trim(),
          intention,
          termsAccepted,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save dating profile.');
        return;
      }
      setMyProfile(data.profile);
      setEditingProfile(false);
      if (user) updateUser({ ...user, datingOptIn: 'yes' });
      setNotice(
        data.profile.approvalStatus === 'pending'
          ? 'Dating profile saved and submitted for admin approval.'
          : 'Dating profile is active!'
      );
      loadDatingMe();
    } catch {
      setError('Network error saving dating profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChooseSingle = async (profile: DatingProfilePublic) => {
    setError('');
    if (!activeSubscription) {
      setShowPackages(true);
      setNotice('Select and activate a USD Singles package below to connect via WhatsApp.');
      return;
    }

    setChoosingId(profile.id);
    try {
      const res = await fetch(`/api/dating/choose/${profile.id}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not select this profile.');
        if (res.status === 403) setShowPackages(true);
        return;
      }

      setLastChosenResult({
        name: profile.displayName,
        whatsapp: data.whatsapp,
        whatsappUrl: data.whatsappUrl,
      });
      loadDatingMe();
      loadProfilesFeed();
    } catch {
      setError('Network error selecting profile.');
    } finally {
      setChoosingId(null);
    }
  };

  const handleBlockProfile = async (profile: DatingProfilePublic) => {
    setError('');
    const res = await fetch(`/api/dating/block/${profile.id}`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.ok) {
      setNotice(`${profile.displayName} has been blocked and hidden from your Singles feed.`);
      loadProfilesFeed();
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTarget) return;
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        listingType: 'dating',
        listingId: reportTarget.id,
        reason: reportReason,
        details: reportDetails.trim(),
      }),
    });
    if (res.ok) {
      setReportTarget(null);
      setReportDetails('');
      setNotice('Report sent to moderators for urgent review.');
    }
  };

  if (!datingEnabled) {
    return (
      <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center space-y-2">
        <Heart className="w-8 h-8 text-rose-900 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">Singles Section Temporarily Closed</h2>
        <p className="text-sm text-slate-500">
          An administrator has temporarily paused Singles visibility.
        </p>
      </div>
    );
  }

  // Unauthenticated visitor landing view
  if (!user) {
    return (
      <div className="space-y-6">
        <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-xl">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-900">
              <Heart className="w-3.5 h-3.5 fill-rose-900" />
              Adults 18+ · Respectful Zimbabwe Singles
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Meet Genuine Singles Across Zimbabwe
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Optional private dating directory. Women connect with men and men connect with women. WhatsApp numbers stay private until you choose a connection with an active pass.
            </p>
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            className="min-h-[48px] px-6 rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            Sign In to Join Singles
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {datingPackages.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white border border-rose-200 rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-900">
                  {pkg.isUnlimited ? '30-Day Subscription' : 'Profile Selection Pack'}
                </p>
                <h3 className="text-base font-bold text-slate-900">{pkg.name}</h3>
                <p className="text-sm text-slate-600">{pkg.description}</p>
              </div>
              <div className="pt-3 border-t border-rose-100 flex items-baseline justify-between">
                <span className="text-2xl font-extrabold text-rose-900 tabular-nums">
                  ${pkg.priceUsd} USD
                </span>
                <button
                  type="button"
                  onClick={onRequireAuth}
                  className="min-h-[40px] px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-900 text-xs font-bold"
                >
                  Sign In to Start
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Signed in but opted out or has not completed dating profile yet
  if ((!myProfile && !editingProfile) || optedInChoice === 'no') {
    return (
      <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto space-y-5">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-900">
            <Heart className="w-3.5 h-3.5 fill-rose-900" />
            Optional Singles Section (18+ Only)
          </span>
          <h2 className="text-xl font-bold text-slate-900">
            Would you also like to join the Dating section and meet singles?
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Participation is completely optional. Female members view male profiles and male members view female profiles. WhatsApp contacts stay hidden from public visitors.
          </p>
        </div>

        {notice && (
          <p className="text-sm text-rose-900 bg-white border border-rose-200 rounded-xl px-4 py-2.5">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleOptInDecision('yes')}
            className="min-h-[46px] px-6 rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-sm font-semibold"
          >
            Yes, Create My 18+ Singles Profile
          </button>
          <button
            type="button"
            onClick={() => handleOptInDecision('no')}
            className="min-h-[46px] px-5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold"
          >
            No, Just Jobs, Market &amp; Houses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {notice && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm text-rose-950">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="text-xs font-bold hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs sm:text-sm text-red-700">
          {error}
        </div>
      )}

      {/* WhatsApp Connection Banner immediately after CHOOSE */}
      {lastChosenResult && (
        <div className="bg-white border-2 border-rose-900 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-900">
              Connection Recorded
            </p>
            <h3 className="text-base font-bold text-slate-900">
              Say hello to {lastChosenResult.name} on WhatsApp
            </h3>
            <p className="text-xs text-slate-500 tabular-nums">
              WhatsApp unlocked: {lastChosenResult.whatsapp}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={lastChosenResult.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] px-5 rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Open WhatsApp Chat
            </a>
            <button
              type="button"
              onClick={() => setLastChosenResult(null)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 flex items-center justify-center text-slate-500"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Dating Profile Drawer */}
      {(editingProfile || !myProfile) && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-white border border-rose-200 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-rose-100 pb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {myProfile ? 'Edit Your Singles Profile' : 'Create Your 18+ Singles Profile'}
              </h2>
              <p className="text-xs text-slate-500">
                Required photo &amp; respectful bio · WhatsApp stays private until chosen
              </p>
            </div>
            {myProfile && (
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="w-20 h-20 rounded-2xl overflow-hidden bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
              {photo ? (
                <img
                  src={resolveAssetUrl(photo)}
                  alt="Dating avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserIcon className="w-8 h-8 text-rose-300" />
              )}
            </div>
            <div className="space-y-1.5">
              <label className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold text-rose-900 cursor-pointer">
                <Camera className="w-4 h-4" />
                {photo ? 'Change Profile Photo' : 'Upload Required Photo'}
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="sr-only" />
              </label>
              <p className="text-xs text-slate-500">Compressed automatically for low mobile data.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name *</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="First name or nickname"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Age (18+) *</label>
              <input
                type="number"
                required
                min={18}
                max={99}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Gender *</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as 'female' | 'male')}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="female">Female (I want to meet Men)</option>
                <option value="male">Male (I want to meet Women)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Country *</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
              >
                {DATING_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">City *</label>
              {country === 'Zimbabwe' ? (
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  {ZIMBABWE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Suburb / Area *</label>
              <input
                type="text"
                required
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
                placeholder="e.g. Avondale, Hillside"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Private WhatsApp *
              </label>
              <input
                type="tel"
                required
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="0771234567"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Intention *
              </label>
              <select
                value={intention}
                onChange={(e) =>
                  setIntention(e.target.value as 'dating' | 'serious_relationship' | 'marriage')
                }
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
              >
                {RELATIONSHIP_INTENTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Children (Optional)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={childrenCount}
                onChange={(e) => setChildrenCount(e.target.value)}
                placeholder="Leave blank to skip"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          {allowHivDisclosure && (
            <div className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    HIV Status (Optional &amp; Private)
                  </label>
                  <select
                    value={hivStatus}
                    onChange={(e) => setHivStatus(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {HIV_STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                {hivStatus !== 'Prefer not to disclose' && (
                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-2 sm:pt-5">
                    <input
                      type="checkbox"
                      checked={shareHivWithSubscribers}
                      onChange={(e) => setShareHivWithSubscribers(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-rose-900"
                    />
                    <span>
                      Allow <strong>paid dating subscribers</strong> of opposite gender to see my HIV status on my card. (Never shown publicly.)
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              About Yourself &amp; Who You Hope to Meet *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Share your values, lifestyle, and what kind of relationship you are seeking..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-rose-900"
            />
            <span>
              I confirm that I am <strong>18 years or older</strong>, accept the Singles Safety &amp; Respect Terms, and consent to my profile appearing only to verified opposite-gender members.
            </span>
          </label>

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full min-h-[46px] rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-sm font-semibold disabled:opacity-60"
          >
            {savingProfile ? 'Saving Profile...' : 'Save Dating Profile'}
          </button>
        </form>
      )}

      {/* Member Status & Active Package Bar */}
      {myProfile && !editingProfile && (
        <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src={resolveAssetUrl(myProfile.photo)}
              alt={myProfile.displayName}
              className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-xs shrink-0"
            />
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {myProfile.displayName}, {myProfile.age}
                </h2>
                <span
                  className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-md ${
                    myProfile.approvalStatus === 'approved'
                      ? 'bg-white text-rose-900 border border-rose-200'
                      : myProfile.approvalStatus === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {myProfile.approvalStatus}
                </span>
              </div>
              <p className="text-xs text-slate-600">
                {myProfile.suburb}, {myProfile.city}, {myProfile.country} · Viewing{' '}
                <strong>{myProfile.gender === 'male' ? 'Female' : 'Male'}</strong> singles
              </p>
              {myProfile.moderationReason && (
                <p className="text-xs text-red-700">{myProfile.moderationReason}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeSubscription ? (
              <div className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 text-xs">
                <span className="font-bold text-rose-900 inline-flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5" />
                  {activeSubscription.packageName}
                </span>
                <span className="text-slate-600 ml-2 tabular-nums">
                  {activeSubscription.isUnlimited
                    ? `Expires ${formatShortDate(activeSubscription.expiresAt)}`
                    : `${activeSubscription.remainingSelections} choice(s) left`}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPackages((p) => !p)}
                className="min-h-[40px] px-4 rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Crown className="w-3.5 h-3.5" />
                Choose Dating Package
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowChosenList((p) => !p)}
              className="min-h-[40px] px-3.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-100/50 text-xs font-semibold text-rose-900"
            >
              Chosen ({mySelections.length})
            </button>

            <button
              type="button"
              onClick={() => setShowPackages((p) => !p)}
              className="min-h-[40px] px-3.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              Packages
            </button>

            <button
              type="button"
              onClick={() => setEditingProfile(true)}
              className="min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>

            <button
              type="button"
              onClick={() => handleOptInDecision('no')}
              title="Leave Singles section"
              className="min-h-[40px] px-3 rounded-xl bg-white border border-slate-200 hover:bg-red-50 text-xs font-semibold text-red-600 inline-flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Leave
            </button>
          </div>
        </div>
      )}

      {/* Dating Packages Pricing Section */}
      {myProfile && (!activeSubscription || showPackages) && (
        <section className="bg-white border border-rose-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Singles Access Packages (USD)
              </h3>
              <p className="text-xs text-slate-500">
                Pay via Paynow Zimbabwe, PayPal, or EcoCash/InnBucks reference to unlock WhatsApp introductions.
              </p>
            </div>
            {activeSubscription && (
              <button
                type="button"
                onClick={() => setShowPackages(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Hide
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {datingPackages.map((pkg) => (
              <div
                key={pkg.id}
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  pkg.isUnlimited
                    ? 'border-rose-900 bg-rose-50/40'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900">
                      {pkg.isUnlimited
                        ? '30-Day Subscription'
                        : `${pkg.minSelections}–${pkg.maxSelections} Singles`}
                    </span>
                    <span className="text-lg font-extrabold text-rose-900 tabular-nums">
                      ${pkg.priceUsd}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{pkg.name}</h4>
                  <p className="text-xs text-slate-600">{pkg.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckoutPkg(pkg)}
                  className="w-full min-h-[42px] rounded-xl bg-rose-900 hover:bg-rose-950 text-white text-xs font-semibold"
                >
                  Select ${pkg.priceUsd} Package
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Chosen Singles Drawer */}
      {showChosenList && mySelections.length > 0 && (
        <section className="bg-white border border-rose-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Your Selected Singles</h3>
            <button
              type="button"
              onClick={() => setShowChosenList(false)}
              className="text-xs font-semibold text-slate-500"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mySelections.map((sel) => {
              const msg = `Hi ${sel.displayName}, I saw your profile on MARKET & JOBS Zimbabwe Singles (${myProfile?.displayName || 'Member'}) and would love to connect.`;
              return (
                <div
                  key={sel.id}
                  className="p-3 rounded-xl border border-rose-100 bg-rose-50/40 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={resolveAssetUrl(sel.photo)}
                      alt={sel.displayName}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {sel.displayName}, {sel.age}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {sel.city} · {sel.whatsapp}
                      </p>
                    </div>
                  </div>
                  <a
                    href={buildDirectWhatsAppUrl(sel.whatsapp, msg)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[38px] px-3 rounded-lg bg-rose-900 text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Chat
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter Bar (Country, City, Location) */}
      {myProfile && !editingProfile && (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or bio..."
              className="w-full min-h-[44px] pl-10 pr-3 rounded-xl bg-white border border-slate-200 text-sm"
            />
          </div>
          <div className="sm:col-span-3">
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              aria-label="Filter by country"
              className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 text-sm"
            >
              <option value="All">All Countries</option>
              {DATING_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              aria-label="Filter by city"
              className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 text-sm"
            >
              <option value="All">All Cities</option>
              {ZIMBABWE_LOCATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 relative">
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Suburb..."
              aria-label="Filter by suburb or location"
              className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-white border border-slate-200 text-sm"
            />
          </div>
        </div>
      )}

      {/* Opposite-Gender Profile Cards Grid */}
      {myProfile && !editingProfile && (
        loadingMe || loadingFeed ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white border border-rose-100 rounded-2xl p-4 space-y-3 animate-pulse"
              >
                <div className="aspect-[4/4] bg-rose-50 rounded-xl" />
                <div className="h-5 bg-slate-100 rounded w-1/2" />
                <div className="h-10 bg-slate-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : profiles.length === 0 ? (
          <div className="bg-white border border-rose-200 rounded-2xl p-10 text-center space-y-2">
            <p className="text-base font-bold text-slate-900">No matching profiles found</p>
            <p className="text-sm text-slate-500">
              Try widening your country, city, or suburb filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {profiles.map((p) => (
              <article
                key={p.id}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="p-3.5 pb-0">
                    <div className="relative aspect-[4/4] rounded-2xl overflow-hidden bg-rose-50">
                      <img
                        src={resolveAssetUrl(p.photo)}
                        alt={p.displayName}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <div className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-lg font-bold text-slate-900">
                            {p.displayName}, {p.age}
                          </h3>
                          {p.isVerified && (
                            <BadgeCheck
                              className="w-4 h-4 text-rose-900 shrink-0"
                              aria-label="Verified Member"
                            />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.suburb}, {p.city} · {p.country}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setReportTarget(p)}
                          title="Report profile"
                          aria-label={`Report ${p.displayName}`}
                          className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlockProfile(p)}
                          title="Block profile"
                          aria-label={`Block ${p.displayName}`}
                          className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs font-semibold text-rose-900">
                      {INTENTION_LABEL[p.intention] ?? p.intention}
                      {p.childrenCount !== null &&
                        ` · ${
                          p.childrenCount === 0
                            ? 'No children'
                            : `${p.childrenCount} ${p.childrenCount === 1 ? 'child' : 'children'}`
                        }`}
                      {p.hivShared && p.hivStatus ? ` · HIV: ${p.hivStatus}` : ''}
                    </p>

                    <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                      {p.description}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-0 space-y-2">
                  {!activeSubscription && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Lock className="w-3 h-3 text-rose-900" />
                      WhatsApp protected · Requires active Dating Package
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={choosingId === p.id}
                    onClick={() => handleChooseSingle(p)}
                    className={`w-full min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                      p.alreadyChosen
                        ? 'bg-rose-50 border border-rose-200 text-rose-900 hover:bg-rose-100'
                        : 'bg-rose-900 hover:bg-rose-950 text-white'
                    }`}
                  >
                    {p.alreadyChosen ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Chosen · Open WhatsApp
                      </>
                    ) : choosingId === p.id ? (
                      'Selecting...'
                    ) : (
                      <>
                        <Heart className="w-4 h-4" />
                        CHOOSE
                      </>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {/* Safety Footer Note */}
      <div className="flex items-center gap-2 text-xs text-slate-500 pt-2">
        <ShieldCheck className="w-4 h-4 text-rose-900 shrink-0" />
        <span>
          18+ only · WhatsApp contacts and sensitive health preferences are strictly protected and never shown publicly.
        </span>
      </div>

      {/* Central Checkout Modal for Selected Dating Package */}
      {checkoutPkg && (
        <PaymentCheckoutModal
          isOpen={Boolean(checkoutPkg)}
          featureType="dating_package"
          targetId={checkoutPkg.id}
          planOrPackageId={checkoutPkg.id}
          itemTitle={checkoutPkg.name}
          amountUsd={checkoutPkg.priceUsd}
          subtitle={checkoutPkg.description}
          capabilities={paymentCapabilities}
          paymentInstructions={paymentInstructions}
          accent="burgundy"
          onClose={() => setCheckoutPkg(null)}
          onSuccess={(msg) => {
            setNotice(msg);
            setShowPackages(false);
            loadDatingMe();
            loadProfilesFeed();
          }}
        />
      )}

      {/* Report Profile Modal */}
      {reportTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setReportTarget(null)}
        >
          <form
            onSubmit={handleReportSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 p-5 w-full max-w-md space-y-3"
          >
            <h3 className="text-base font-bold text-slate-900">
              Report {reportTarget.displayName}
            </h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="Fake or misleading profile">Fake or misleading profile</option>
              <option value="Underage concern (Under 18)">Underage concern (Under 18)</option>
              <option value="Harassment or abusive messages">Harassment or abusive messages</option>
              <option value="Scam or money request">Scam or money request</option>
            </select>
            <input
              type="text"
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Optional extra details..."
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="min-h-[40px] px-4 rounded-lg border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-lg bg-red-600 text-white text-xs font-semibold"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
