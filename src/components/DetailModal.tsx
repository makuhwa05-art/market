import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, MessageCircle, Pencil, User, X } from 'lucide-react';
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
  currentUserId: string | null;
  onClose: () => void;
  onEdit: (selection: DetailSelection) => void;
}

export function DetailModal({ selection, currentUserId, onClose, onEdit }: DetailModalProps) {
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    setPhotoIndex(0);
  }, [selection]);

  if (!selection) return null;

  const isOwner = currentUserId !== null && selection.item.userId === currentUserId;
  const photos =
    selection.type === 'job' ? [] : selection.item.photos;
  const activePhoto = photos[photoIndex] ?? photos[0];

  let waHref = '#';
  let waLabel = 'CONTACT ON WHATSAPP';
  if (selection.type === 'job') {
    const j = selection.item;
    waHref = buildWhatsAppUrl(j.whatsapp, buildJobWhatsAppMessage(j.title, j.company, j.location));
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
    waLabel = 'CONTACT ON WHATSAPP';
  }

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
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {selection.type === 'job'
              ? 'Job Details'
              : selection.type === 'market'
                ? 'Market Listing'
                : 'Property Rental'}
          </span>
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
              <p className="text-sm font-medium text-slate-700">{selection.item.company}</p>
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

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" aria-hidden="true" />
              Posted by <strong className="font-semibold text-slate-700">{selection.item.authorName}</strong>
            </span>
            <span className="tabular-nums font-medium text-slate-700">
              {formatZimbabwePhoneDisplay(selection.item.whatsapp)}
            </span>
          </div>
        </div>

        <div className="p-4 sm:px-6 border-t border-slate-200 bg-white pb-safe">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[48px] px-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold tracking-wide transition-colors"
          >
            <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {waLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
