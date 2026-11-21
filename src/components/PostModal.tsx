import React, { useEffect, useState } from 'react';
import { Briefcase, Home, ImagePlus, ShoppingBag, Trash2, Wand2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  HOUSE_FACILITIES,
  HOUSE_TYPES,
  JOB_CATEGORIES,
  MARKET_CATEGORIES,
  ZIMBABWE_LOCATIONS,
} from '../types';
import type { HouseListing, JobListing, MarketListing, TabType } from '../types';
import { compressImageFile } from '../utils/imageCompression';
import { isValidZimbabwePhone, normalizeZimbabwePhone } from '../utils/whatsapp';

export type EditTarget =
  | { type: 'job'; item: JobListing }
  | { type: 'market'; item: MarketListing }
  | { type: 'house'; item: HouseListing };

interface PostModalProps {
  isOpen: boolean;
  editTarget: EditTarget | null;
  defaultTab?: TabType;
  onClose: () => void;
  onRequireAuth: () => void;
  onSaved: (tab: TabType) => void;
}

export function PostModal({
  isOpen,
  editTarget,
  onClose,
  onRequireAuth,
  onSaved,
}: PostModalProps) {
  const { user, authHeaders } = useAuth();
  const [postType, setPostType] = useState<TabType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [error, setError] = useState('');
  const [photoStatus, setPhotoStatus] = useState('');

  // Job fields
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jobCategory, setJobCategory] = useState<string>('Sales & Retail');
  const [jobLocation, setJobLocation] = useState<string>('Harare');
  const [salary, setSalary] = useState('');
  const [requirements, setRequirements] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [jobWhatsapp, setJobWhatsapp] = useState('');

  // Market fields
  const [itemTitle, setItemTitle] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [itemCategory, setItemCategory] = useState<string>('Electronics & Solar');
  const [itemLocation, setItemLocation] = useState<string>('Harare');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPhotos, setItemPhotos] = useState<string[]>([]);
  const [itemWhatsapp, setItemWhatsapp] = useState('');

  // House fields
  const [propertyType, setPropertyType] = useState<HouseListing['propertyType']>('House');
  const [houseTitle, setHouseTitle] = useState('');
  const [suburb, setSuburb] = useState('');
  const [houseCity, setHouseCity] = useState<string>('Harare');
  const [housePrice, setHousePrice] = useState('');
  const [bedrooms, setBedrooms] = useState('2');
  const [facilities, setFacilities] = useState<string[]>([]);
  const [houseDescription, setHouseDescription] = useState('');
  const [housePhotos, setHousePhotos] = useState<string[]>([]);
  const [houseWhatsapp, setHouseWhatsapp] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setPhotoStatus('');

    if (editTarget) {
      if (editTarget.type === 'job') {
        const j = editTarget.item;
        setPostType('jobs');
        setJobTitle(j.title);
        setCompany(j.company);
        setJobCategory(j.category);
        setJobLocation(j.location);
        setSalary(j.salary ?? '');
        setRequirements(j.requirements);
        setJobDescription(j.description);
        setJobWhatsapp(j.whatsapp);
      } else if (editTarget.type === 'market') {
        const m = editTarget.item;
        setPostType('market');
        setItemTitle(m.title);
        setItemPrice(String(m.price));
        setCurrency(m.currency);
        setItemCategory(m.category);
        setItemLocation(m.location);
        setItemDescription(m.description);
        setItemPhotos(m.photos);
        setItemWhatsapp(m.whatsapp);
      } else {
        const h = editTarget.item;
        setPostType('houses');
        setPropertyType(h.propertyType);
        setHouseTitle(h.title);
        setSuburb(h.suburb);
        setHouseCity(h.city);
        setHousePrice(String(h.price));
        setBedrooms(String(h.bedrooms));
        setFacilities(h.facilities);
        setHouseDescription(h.description);
        setHousePhotos(h.photos);
        setHouseWhatsapp(h.whatsapp);
      }
      return;
    }

    // Reset for fresh post
    setPostType(null);
    const defaultPhone = user?.phone ?? '';
    const defaultCity = user?.city ?? 'Harare';

    setJobTitle('');
    setCompany('');
    setJobCategory('Sales & Retail');
    setJobLocation(defaultCity);
    setSalary('');
    setRequirements('');
    setJobDescription('');
    setJobWhatsapp(defaultPhone);

    setItemTitle('');
    setItemPrice('');
    setCurrency('USD');
    setItemCategory('Electronics & Solar');
    setItemLocation(defaultCity);
    setItemDescription('');
    setItemPhotos([]);
    setItemWhatsapp(defaultPhone);

    setPropertyType('House');
    setHouseTitle('');
    setSuburb('');
    setHouseCity(defaultCity);
    setHousePrice('');
    setBedrooms('2');
    setFacilities([]);
    setHouseDescription('');
    setHousePhotos([]);
    setHouseWhatsapp(defaultPhone);
  }, [isOpen, editTarget, user]);

  if (!isOpen) return null;

  const handlePhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'market' | 'houses'
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const currentPhotos = target === 'market' ? itemPhotos : housePhotos;
    const remainingSlots = 4 - currentPhotos.length;
    if (remainingSlots <= 0) {
      setError('You can attach up to 4 photos per listing.');
      e.target.value = '';
      return;
    }

    setError('');
    try {
      const compressed: string[] = [];
      let totalKb = 0;
      for (const file of files.slice(0, remainingSlots)) {
        const result = await compressImageFile(file, { maxDimension: 840, quality: 0.72 });
        compressed.push(result.dataUrl);
        totalKb += result.sizeKb;
      }
      if (target === 'market') {
        setItemPhotos((prev) => [...prev, ...compressed].slice(0, 4));
      } else {
        setHousePhotos((prev) => [...prev, ...compressed].slice(0, 4));
      }
      setPhotoStatus(`Added ${compressed.length} compressed photo(s) (${totalKb} KB total)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compress selected image.');
    } finally {
      e.target.value = '';
    }
  };

  const toggleFacility = (facility: string) => {
    setFacilities((prev) =>
      prev.includes(facility) ? prev.filter((f) => f !== facility) : [...prev, facility]
    );
  };

  const handleGenerateHouseDescription = async () => {
    setError('');
    if (!houseTitle.trim() && !suburb.trim()) {
      setError('Enter the property title or suburb first so AI can write an accurate description.');
      return;
    }

    setAiGenerating(true);
    try {
      const res = await fetch('/api/houses/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          propertyType,
          title: houseTitle,
          suburb,
          city: houseCity,
          price: housePrice,
          bedrooms: propertyType === 'Commercial' ? 0 : bedrooms,
          facilities,
          notes: houseDescription,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not generate property description.');
        return;
      }
      setHouseDescription(data.description);
    } catch {
      setError('Network error while generating AI description.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidZimbabwePhone(jobWhatsapp)) {
      setError('Enter a valid Zimbabwe WhatsApp number (e.g. 0771234567).');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = editTarget?.type === 'job';
      const url = isEditing ? `/api/jobs/${editTarget.item.id}` : '/api/jobs';
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: jobTitle,
          company,
          category: jobCategory,
          location: jobLocation,
          salary: salary || null,
          requirements,
          description: jobDescription,
          whatsapp: normalizeZimbabwePhone(jobWhatsapp),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save job post.');
        return;
      }
      onSaved('jobs');
      onClose();
    } catch {
      setError('Network error while saving job post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const numericPrice = Number(itemPrice);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      setError('Please enter a valid price.');
      return;
    }
    if (!isValidZimbabwePhone(itemWhatsapp)) {
      setError('Enter a valid Zimbabwe WhatsApp number.');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = editTarget?.type === 'market';
      const url = isEditing ? `/api/market/${editTarget.item.id}` : '/api/market';
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: itemTitle,
          price: numericPrice,
          currency,
          category: itemCategory,
          location: itemLocation,
          description: itemDescription,
          photos: itemPhotos,
          whatsapp: normalizeZimbabwePhone(itemWhatsapp),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save market listing.');
        return;
      }
      onSaved('market');
      onClose();
    } catch {
      setError('Network error while saving market listing.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitHouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const numericPrice = Number(housePrice);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Please enter a valid monthly rental price.');
      return;
    }
    if (!isValidZimbabwePhone(houseWhatsapp)) {
      setError('Enter a valid Zimbabwe WhatsApp number.');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = editTarget?.type === 'house';
      const url = isEditing ? `/api/houses/${editTarget.item.id}` : '/api/houses';
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          propertyType,
          title: houseTitle,
          suburb,
          city: houseCity,
          price: numericPrice,
          bedrooms: propertyType === 'Commercial' ? 0 : Number(bedrooms),
          facilities,
          description: houseDescription,
          photos: housePhotos,
          whatsapp: normalizeZimbabwePhone(houseWhatsapp),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save property listing.');
        return;
      }
      onSaved('houses');
      onClose();
    } catch {
      setError('Network error while saving property listing.');
    } finally {
      setSubmitting(false);
    }
  };

  const heading = editTarget
    ? editTarget.type === 'job'
      ? 'Edit Job Post'
      : editTarget.type === 'market'
        ? 'Edit Market Listing'
        : 'Edit Property Listing'
    : postType === 'jobs'
      ? 'Post a Job'
      : postType === 'market'
        ? 'Sell a Product / Service'
        : postType === 'houses'
          ? 'Advertise a House / Room'
          : 'What would you like to post?';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            {postType && !editTarget && (
              <button
                type="button"
                onClick={() => {
                  setPostType(null);
                  setError('');
                }}
                className="min-h-[36px] px-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md"
              >
                Back
              </button>
            )}
            <h2 className="text-base font-bold text-slate-900 truncate">{heading}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close post modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {!user ? (
            <div className="py-4 space-y-4 text-center">
              <p className="text-sm text-slate-700 leading-relaxed">
                Sign in or create a quick profile so you can publish posts and edit or remove them anytime.
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="w-full min-h-[46px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors"
              >
                Sign In or Create Account
              </button>
            </div>
          ) : !postType ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setPostType('jobs')}
                className="w-full min-h-[68px] p-4 rounded-xl border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 flex items-center gap-4 text-left transition-colors"
              >
                <div className="w-11 h-11 rounded-lg bg-slate-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <Briefcase className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Post a Job</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Hire staff, drivers, tradespeople, or office talent
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPostType('market')}
                className="w-full min-h-[68px] p-4 rounded-xl border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 flex items-center gap-4 text-left transition-colors"
              >
                <div className="w-11 h-11 rounded-lg bg-slate-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Sell a Product / Service</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    List solar kits, phones, vehicles, produce, or repairs
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPostType('houses')}
                className="w-full min-h-[68px] p-4 rounded-xl border border-slate-200 hover:border-emerald-700 hover:bg-emerald-50/40 flex items-center gap-4 text-left transition-colors"
              >
                <div className="w-11 h-11 rounded-lg bg-slate-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <Home className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Advertise a House / Room</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Rent out houses, rooms, cottages, flats, or shops
                  </div>
                </div>
              </button>
            </div>
          ) : null}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5" role="alert">
              {error}
            </p>
          )}

          {user && postType === 'jobs' && (
            <form onSubmit={handleSubmitJob} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Job Title</label>
                <input
                  type="text"
                  required
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g. Solar Technician"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Company Name</label>
                  <input
                    type="text"
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. SunGrid Zimbabwe"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Salary (Optional)
                  </label>
                  <input
                    type="text"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    placeholder="e.g. USD 500/month"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category</label>
                  <select
                    value={jobCategory}
                    onChange={(e) => setJobCategory(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {JOB_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Location</label>
                  <select
                    value={jobLocation}
                    onChange={(e) => setJobLocation(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {ZIMBABWE_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Job Description</label>
                <textarea
                  required
                  rows={3}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Describe daily duties, hours, and work setup..."
                  className="w-full p-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Requirements</label>
                <textarea
                  required
                  rows={2}
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Qualifications, years of experience, driver's licence..."
                  className="w-full p-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  WhatsApp Number for Applications
                </label>
                <input
                  type="tel"
                  required
                  value={jobWhatsapp}
                  onChange={(e) => setJobWhatsapp(e.target.value)}
                  placeholder="0771234567"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Publishing...' : editTarget ? 'Save Changes' : 'Publish Job'}
              </button>
            </form>
          )}

          {user && postType === 'market' && (
            <form onSubmit={handleSubmitMarket} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Product or Service Name
                </label>
                <input
                  type="text"
                  required
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="e.g. 5kVA Solar Inverter or Plumbing Repairs"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Price</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    placeholder="0"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value === 'ZiG' ? 'ZiG' : 'USD')}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="ZiG">ZiG</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {MARKET_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Location</label>
                  <select
                    value={itemLocation}
                    onChange={(e) => setItemLocation(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {ZIMBABWE_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  required
                  rows={3}
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="Condition, specifications, delivery options..."
                  className="w-full p-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Photos (Up to 4, auto-compressed)
                  </label>
                  {photoStatus && <span className="text-xs text-emerald-700">{photoStatus}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {itemPhotos.map((src, idx) => (
                    <div key={idx} className="relative w-20 h-16 rounded-lg overflow-hidden border border-slate-200">
                      <img src={src} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => setItemPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/75 text-white flex items-center justify-center"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {itemPhotos.length < 4 && (
                    <label className="w-20 h-16 rounded-lg border border-dashed border-slate-300 hover:border-emerald-700 flex flex-col items-center justify-center text-slate-500 hover:text-emerald-700 cursor-pointer transition-colors">
                      <ImagePlus className="w-5 h-5" aria-hidden="true" />
                      <span className="text-[10px] font-medium mt-0.5">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => handlePhotoUpload(e, 'market')}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Seller&apos;s WhatsApp Number
                </label>
                <input
                  type="tel"
                  required
                  value={itemWhatsapp}
                  onChange={(e) => setItemWhatsapp(e.target.value)}
                  placeholder="0771234567"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Publishing...' : editTarget ? 'Save Changes' : 'Publish Listing'}
              </button>
            </form>
          )}

          {user && postType === 'houses' && (
            <form onSubmit={handleSubmitHouse} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Property Type</label>
                  <select
                    value={propertyType}
                    onChange={(e) =>
                      setPropertyType(e.target.value as HouseListing['propertyType'])
                    }
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {HOUSE_TYPES.filter((t) => t !== 'All').map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Monthly Rent (USD)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={housePrice}
                    onChange={(e) => setHousePrice(e.target.value)}
                    placeholder="e.g. 350"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Property Title</label>
                <input
                  type="text"
                  required
                  value={houseTitle}
                  onChange={(e) => setHouseTitle(e.target.value)}
                  placeholder="e.g. Neat 2-Bedroom Garden Cottage"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Suburb</label>
                  <input
                    type="text"
                    required
                    value={suburb}
                    onChange={(e) => setSuburb(e.target.value)}
                    placeholder="e.g. Avondale"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Town</label>
                  <select
                    value={houseCity}
                    onChange={(e) => setHouseCity(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    {ZIMBABWE_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Bedrooms</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    disabled={propertyType === 'Commercial'}
                    value={propertyType === 'Commercial' ? '0' : bedrooms}
                    onChange={(e) => setBedrooms(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">Facilities</label>
                <div className="flex flex-wrap gap-1.5">
                  {HOUSE_FACILITIES.map((fac) => {
                    const active = facilities.includes(fac);
                    return (
                      <button
                        key={fac}
                        type="button"
                        onClick={() => toggleFacility(fac)}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {fac}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">Description</label>
                  <button
                    type="button"
                    disabled={aiGenerating}
                    onClick={handleGenerateHouseDescription}
                    className="min-h-[34px] px-2.5 inline-flex items-center gap-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {aiGenerating ? 'Writing...' : 'AI Write Description'}
                  </button>
                </div>
                <textarea
                  required
                  rows={4}
                  value={houseDescription}
                  onChange={(e) => setHouseDescription(e.target.value)}
                  placeholder="Describe rooms, water/power setup, security, and nearby amenities — or tap AI Write Description above."
                  className="w-full p-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Photos (Up to 4, auto-compressed)
                  </label>
                  {photoStatus && <span className="text-xs text-emerald-700">{photoStatus}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {housePhotos.map((src, idx) => (
                    <div key={idx} className="relative w-20 h-16 rounded-lg overflow-hidden border border-slate-200">
                      <img src={src} alt={`Property ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => setHousePhotos((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/75 text-white flex items-center justify-center"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {housePhotos.length < 4 && (
                    <label className="w-20 h-16 rounded-lg border border-dashed border-slate-300 hover:border-emerald-700 flex flex-col items-center justify-center text-slate-500 hover:text-emerald-700 cursor-pointer transition-colors">
                      <ImagePlus className="w-5 h-5" aria-hidden="true" />
                      <span className="text-[10px] font-medium mt-0.5">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => handlePhotoUpload(e, 'houses')}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Landlord&apos;s WhatsApp Number
                </label>
                <input
                  type="tel"
                  required
                  value={houseWhatsapp}
                  onChange={(e) => setHouseWhatsapp(e.target.value)}
                  placeholder="0771234567"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Publishing...' : editTarget ? 'Save Changes' : 'Publish Property'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
