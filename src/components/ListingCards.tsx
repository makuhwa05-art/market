import { useState } from 'react';
import { BadgeCheck, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import type { HouseListing, JobListing, MarketListing } from '../types';
import {
  buildHouseWhatsAppMessage,
  buildJobWhatsAppMessage,
  buildMarketWhatsAppMessage,
  buildWhatsAppUrl,
  formatTimeAgo,
} from '../utils/whatsapp';
import { ListingImage } from './ListingImage';

interface OwnerActionsProps {
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

function OwnerActions({ onEdit, onDelete }: OwnerActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-600 mr-auto">Remove this post?</span>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="min-h-[38px] px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
              setConfirming(false);
            }
          }}
          className="min-h-[38px] px-3 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
        >
          {deleting ? 'Removing...' : 'Confirm'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
      <button
        type="button"
        onClick={onEdit}
        className="min-h-[40px] px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        Edit
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-[40px] px-3 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        Delete
      </button>
    </div>
  );
}

export function JobCard({
  job,
  isOwner,
  onSelect,
  onEdit,
  onDelete,
}: {
  job: JobListing;
  isOwner: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const isClosed =
    job.lifecycleStatus === 'filled' ||
    job.lifecycleStatus === 'expired' ||
    job.approvalStatus === 'rejected';
  const waHref = buildWhatsAppUrl(
    job.whatsapp,
    buildJobWhatsAppMessage(job.title, job.employer, job.location)
  );

  return (
    <article
      className={`bg-white border rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4 transition-colors ${
        job.isSponsored ? 'border-amber-500/70 bg-amber-50/15' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="space-y-2.5">
        {job.isSponsored && (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
              SPONSORED
            </span>
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onSelect}
            className="text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded min-w-0"
          >
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-snug group-hover:text-emerald-800 transition-colors">
              {job.title}
            </h3>
            <p className="text-sm font-medium text-slate-700 mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
              <span>{job.employer}</span>
              {job.isVerified && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Verified
                </span>
              )}
            </p>
          </button>
          {job.salary && (
            <span className="text-sm font-semibold text-emerald-800 tabular-nums whitespace-nowrap shrink-0">
              {job.salary}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {job.lifecycleStatus === 'filled' && (
            <span className="font-semibold text-amber-700">Position Filled · </span>
          )}
          {job.employmentType}
          <span aria-hidden="true"> · </span>
          {job.location}
          <span aria-hidden="true"> · </span>
          {job.category}
          <span aria-hidden="true"> · </span>
          {formatTimeAgo(job.createdAt)}
        </p>

        <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{job.description}</p>

        <p className="text-xs text-slate-500 line-clamp-2">
          <span className="font-semibold text-slate-700">Requirements:</span> {job.requirements}
        </p>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          {isClosed ? (
            <span className="flex-1 min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 text-xs sm:text-sm font-semibold tracking-wide whitespace-nowrap">
              {job.lifecycleStatus === 'filled' ? 'POSITION FILLED' : 'CLOSED'}
            </span>
          ) : (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-h-[44px] px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold tracking-wide transition-all whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              APPLY ON WHATSAPP
            </a>
          )}
          <button
            type="button"
            onClick={onSelect}
            className="min-h-[44px] px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            Details
          </button>
        </div>

        {isOwner && <OwnerActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  );
}

export function MarketCard({
  item,
  isOwner,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: MarketListing;
  isOwner: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const isClosed =
    item.lifecycleStatus === 'sold' ||
    item.lifecycleStatus === 'expired' ||
    item.approvalStatus === 'rejected';
  const waHref = buildWhatsAppUrl(
    item.whatsapp,
    buildMarketWhatsAppMessage(item.title, item.price, item.currency, item.location)
  );

  return (
    <article
      className={`group bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-colors ${
        item.isSponsored ? 'border-amber-500/70' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div>
        <div className="relative">
          <button
            type="button"
            onClick={onSelect}
            className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <ListingImage
              src={item.photos[0]}
              alt={item.title}
              variant="market"
              photoCount={item.photos.length}
            />
          </button>
          {item.isSponsored && (
            <span className="absolute top-2.5 left-2.5 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400 text-slate-950 shadow-xs">
              SPONSORED
            </span>
          )}
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <button
              type="button"
              onClick={onSelect}
              className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded min-w-0"
            >
              <h3 className="text-base font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-emerald-800 transition-colors">
                {item.title}
              </h3>
            </button>
            <span className="text-base font-bold text-slate-900 tabular-nums whitespace-nowrap shrink-0">
              {item.currency === 'USD'
                ? `$${item.price.toLocaleString()}`
                : `ZiG ${item.price.toLocaleString()}`}
            </span>
          </div>

          <p className="text-xs text-slate-500">
            {item.lifecycleStatus === 'sold' && (
              <span className="font-semibold text-amber-700">Sold · </span>
            )}
            {item.isVerified && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 mr-1.5">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Verified ·
              </span>
            )}
            {item.category}
            <span aria-hidden="true"> · </span>
            {item.location}
            <span aria-hidden="true"> · </span>
            {formatTimeAgo(item.createdAt)}
          </p>

          <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{item.description}</p>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2.5">
        {isClosed ? (
          <span className="w-full min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 text-xs sm:text-sm font-semibold tracking-wide whitespace-nowrap">
            {item.lifecycleStatus === 'sold' ? 'ITEM SOLD' : 'LISTING CLOSED'}
          </span>
        ) : (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[44px] px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold tracking-wide transition-all whitespace-nowrap"
          >
            <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            CONTACT SELLER ON WHATSAPP
          </a>
        )}

        {isOwner && <OwnerActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  );
}

export function HouseCard({
  house,
  isOwner,
  onSelect,
  onEdit,
  onDelete,
}: {
  house: HouseListing;
  isOwner: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const isClosed =
    house.lifecycleStatus === 'rented' ||
    house.lifecycleStatus === 'expired' ||
    house.approvalStatus === 'rejected';
  const waHref = buildWhatsAppUrl(
    house.whatsapp,
    buildHouseWhatsAppMessage(house.title, house.suburb, house.city, house.price)
  );

  const bedLabel =
    house.propertyType === 'Commercial'
      ? 'Commercial'
      : `${house.bedrooms} ${house.bedrooms === 1 ? 'Bed' : 'Beds'}`;

  return (
    <article
      className={`group bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-colors ${
        house.isSponsored ? 'border-amber-500/70' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div>
        <div className="relative">
          <button
            type="button"
            onClick={onSelect}
            className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
          >
            <ListingImage
              src={house.photos[0]}
              alt={house.title}
              variant="house"
              photoCount={house.photos.length}
            />
          </button>
          {house.isSponsored && (
            <span className="absolute top-2.5 left-2.5 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400 text-slate-950 shadow-xs">
              SPONSORED
            </span>
          )}
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <button
              type="button"
              onClick={onSelect}
              className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded min-w-0"
            >
              <h3 className="text-base font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-emerald-800 transition-colors">
                {house.title}
              </h3>
            </button>
            <span className="text-base font-bold text-slate-900 tabular-nums whitespace-nowrap shrink-0">
              ${house.price.toLocaleString()}/mo
            </span>
          </div>

          <p className="text-xs text-slate-500">
            {house.lifecycleStatus === 'rented' && (
              <span className="font-semibold text-amber-700">Rented · </span>
            )}
            {house.isVerified && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 mr-1.5">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Verified ·
              </span>
            )}
            {house.propertyType}
            <span aria-hidden="true"> · </span>
            {bedLabel}
            <span aria-hidden="true"> · </span>
            {house.suburb}, {house.city}
            <span aria-hidden="true"> · </span>
            {formatTimeAgo(house.createdAt)}
          </p>

          {house.facilities.length > 0 && (
            <p className="text-xs font-medium text-emerald-800 line-clamp-1">
              {house.facilities.slice(0, 3).join(' · ')}
              {house.facilities.length > 3 ? ` · +${house.facilities.length - 3} more` : ''}
            </p>
          )}

          <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{house.description}</p>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2.5">
        {isClosed ? (
          <span className="w-full min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 text-xs sm:text-sm font-semibold tracking-wide whitespace-nowrap">
            {house.lifecycleStatus === 'rented' ? 'PROPERTY RENTED' : 'LISTING CLOSED'}
          </span>
        ) : (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[44px] px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold tracking-wide transition-all whitespace-nowrap"
          >
            <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            CONTACT LANDLORD ON WHATSAPP
          </a>
        )}

        {isOwner && <OwnerActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  );
}
