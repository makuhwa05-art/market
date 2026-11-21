import { useState } from 'react';
import { Home, ShoppingBag } from 'lucide-react';

interface ListingImageProps {
  src?: string;
  alt: string;
  variant: 'market' | 'house';
  className?: string;
  photoCount?: number;
}

export function ListingImage({ src, alt, variant, className = '', photoCount = 0 }: ListingImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`relative aspect-[4/3] w-full overflow-hidden bg-slate-100 flex flex-col items-center justify-center text-slate-400 select-none ${className}`}
      >
        {variant === 'house' ? (
          <Home className="w-9 h-9 stroke-[1.5] text-slate-300" aria-hidden="true" />
        ) : (
          <ShoppingBag className="w-9 h-9 stroke-[1.5] text-slate-300" aria-hidden="true" />
        )}
        <span className="mt-1.5 text-xs font-medium text-slate-400">No photo added</span>
      </div>
    );
  }

  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden bg-slate-100 ${className}`}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
      {photoCount > 1 && (
        <span className="absolute bottom-2.5 right-2.5 bg-slate-900/75 text-white text-xs font-medium px-2 py-0.5 rounded-md tabular-nums">
          1 / {photoCount}
        </span>
      )}
    </div>
  );
}
