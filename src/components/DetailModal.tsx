import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Flag,
  MapPin,
  MessageCircle,
  Pencil,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { HouseListing, JobListing, MarketListing } from '../types';
import {
  buildHouseWhatsAppMessage,
  buildJobWhatsAppMessage,
  buildMarketWhatsAppMessage,
  buildWhatsAppUrl,
  formatTimeAgo,
  formatZimbabwePhoneDisplay,
} from '../utils/whatsapp';
import { ListingImage } from './ListingImage';

export type DetailSelection =
  | { type: 'job'; item: JobListing }
  | { type: 'market'; item: MarketListing }
  | { type: 'house'; item: HouseListing };

interface DetailModalProps {
  selection: DetailSelection | null;
  currentUserId: number | null;
  onClose: () => void;
  onEdit: (selection: DetailSelection) => void;
}

const REPORT_REASONS = [
  'Suspected scam or fake ad',
  'Wrong price or misleading details',
  'Item/job/house already taken',
  'Inappropriate or offensive content',
] as const;

export function DetailModal({ selection, currentUserId, onClose, onEdit }: DetailModalProps) {
  const { authHeaders } = useAuth();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    setPhotoIndex(0);
    setReportOpen(false);
    setReportSent(false);
    setReportDetails('');
    setReportError('');
  }, [selection]);

  if (!selection) return null;

  const isOwner = currentUserId !== null && selection.item.userId === currentUserId;
  const photos = selection.type === 'job' ? [] : selection.item.photos;
  const activePhoto = photos[photoIndex] ?? photos[0];
  const lifecycle = selection.item.lifecycleStatus ?? 'active';
  const isClosed =
    lifecycle === 'filled' ||
    lifecycle === 'sold' ||
    lifecycle === 'rented' ||
    lifecycle === 'expired';

  let waHref = '#';
  let waLabel = 'CONTACT ON WHATSAPP';
  if (selection.type === 'job') {
    const j = selection.item;
    waHref = buildWhatsAppUrl(j.whatsapp, buildJobWhatsAppMessage(j.title, j.employer, j.location));
    waLabel = 'APPLY ON WHATSAPP';
  } else if (selection.type === 'market') {
    const m = selection.item;
    waHref = buildWhatsAppUrl(
      m.whatsapp,
      buildMarketWhatsAppMessage(m.title, m.price, m.currency, m.location)
    );
    waLabel = 'CONTACT SELLER ON WHATSAPP';
  } else {
    const h = selection.item;
    waHref = buildWhatsAppUrl(
      h.whatsapp,
      buildHouseWhatsAppMessage(h.title, h.suburb, h.city, h.price)
    );
    waLabel = 'CONTACT LANDLORD ON WHATSAPP';
  }

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReporting(true);
    setReportError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          listingType: selection.type,
          listingId: selection.item.id,
          reason: reportReason,
          details: reportDetails.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error || 'Could not submit report.');
        return;
      }
      setReportSent(true);
      setReportOpen(false);
    } catch {
      setReportError('Network error submitting report.');
    } finally {
      setReporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {selection.type === 'job'
                ? 'Job Details'
                : selection.type === 'market'
                  ? 'Market Listing'
                  : 'Property Rental'}
            </span>
            {selection.item.isSponsored && (
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                SPONSORED
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <button
                type="button"
                onClick={() => onEdit(selection)}
                className="min-h-[40px] px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          {selection.type !== 'job' && (
            <div className="relative rounded-xl overflow-hidden border border-slate-200">
              <ListingImage
                src={activePhoto}
                alt={selection.item.title}
                variant={selection.type}
              />
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous photo"
                    onClick={() => setPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length)}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] rounded-full bg-white/90 text-slate-900 flex items-center justify-center shadow-sm hover:bg-white"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next photo"
                    onClick={() => setPhotoIndex((prev) => (prev + 1) % photos.length)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] rounded-full bg-white/90 text-slate-900 flex items-center justify-center shadow-sm hover:bg-white"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 bg-slate-900/75 text-white text-xs font-medium px-2.5 py-1 rounded-md tabular-nums">
                    {photoIndex + 1} / {photos.length}
                  </div>
                </>
              )}
            </div>
          )}

          {selection.type === 'job' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold text-slate-900">{selection.item.title}</h2>
                {selection.item.salary && (
                  <span className="text-base font-bold text-emerald-800 tabular-nums">
                    {selection.item.salary}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-slate-700">
                {selection.item.employer} · {selection.item.employmentType}
              </p>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {selection.item.location} · {selection.item.category} · {formatTimeAgo(selection.item.createdAt)}
              </p>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Job Description
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {selection.item.description}
                </p>
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Requirements
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {selection.item.requirements}
                </p>
              </div>
            </div>
          )}

          {selection.type === 'market' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold text-slate-900">{selection.item.title}</h2>
                <span className="text-xl font-bold text-slate-900 tabular-nums">
                  {selection.item.currency === 'USD'
                    ? `$${selection.item.price.toLocaleString()}`
                    : `ZiG ${selection.item.price.toLocaleString()}`}
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {selection.item.location} · {selection.item.category} · {formatTimeAgo(selection.item.createdAt)}
              </p>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Description
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {selection.item.description}
                </p>
              </div>
            </div>
          )}

          {selection.type === 'house' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold text-slate-900">{selection.item.title}</h2>
                <span className="text-xl font-bold text-slate-900 tabular-nums">
                  ${selection.item.price.toLocaleString()}/month
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {selection.item.suburb}, {selection.item.city} · {selection.item.propertyType}
                {selection.item.propertyType !== 'Commercial'
                  ? ` · ${selection.item.bedrooms} ${selection.item.bedrooms === 1 ? 'Bedroom' : 'Bedrooms'}`
                  : ''}
                {' · '}
                {formatTimeAgo(selection.item.createdAt)}
              </p>
              {selection.item.facilities.length > 0 && (
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Facilities
                  </h3>
                  <p className="text-sm font-medium text-emerald-800">
                    {selection.item.facilities.join(' · ')}
                  </p>
                </div>
              )}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Property Description
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {selection.item.description}
                </p>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" aria-hidden="true" />
              Posted by <strong className="font-semibold text-slate-700">{selection.item.authorName}</strong>
              {selection.item.isVerified && (
                <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold">
                  <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Verified
                </span>
              )}
            </span>
            <span className="tabular-nums font-medium text-slate-700">
              {formatZimbabwePhoneDisplay(selection.item.whatsapp)}
            </span>
          </div>

          {!isOwner && (
            <div className="pt-2">
              {reportSent ? (
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  Thank you. Your report has been sent to the administrator for review.
                </p>
              ) : reportOpen ? (
                <form
                  onSubmit={handleSubmitReport}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">Report Suspicious Ad</span>
                    <button
                      type="button"
                      onClick={() => setReportOpen(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                  {reportError && <p className="text-xs text-red-700">{reportError}</p>}
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    {REPORT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Optional extra details..."
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={reporting}
                    className="w-full min-h-[40px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {reporting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
                >
                  <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                  Report suspicious listing
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-4 sm:px-6 border-t border-slate-200 bg-white pb-safe">
          {isClosed ? (
            <span className="w-full min-h-[48px] px-5 inline-flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 text-sm font-semibold tracking-wide">
              LISTING MARKED {lifecycle.toUpperCase()}
            </span>
          ) : (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[48px] px-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold tracking-wide transition-colors"
            >
              <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              {waLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
