'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface Img {
  id: string;
  public_url: string | null;
  storage_path: string | null;
  is_primary: boolean;
}

export default function ProductGallery({ images, locale }: { images: Img[]; locale: 'ar' | 'en' }) {
  const withUrl = images.filter((i) => i.public_url);
  const [active, setActive] = useState(0);
  const ar = locale === 'ar';

  if (withUrl.length === 0) {
    return (
      <div className="card flex aspect-square items-center justify-center text-center">
        <div className="text-faint">
          <ImageOff size={32} className="mx-auto" />
          <p className="mt-2 text-xs">
            {images.length > 0
              ? ar ? 'صور محلية غير مرفوعة بعد — شغّل npm run upload:images' : 'Images exist locally but not uploaded — run npm run upload:images'
              : ar ? 'لا توجد صور' : 'No images'}
          </p>
        </div>
      </div>
    );
  }

  const current = withUrl[Math.min(active, withUrl.length - 1)];

  return (
    <div>
      <div className="card overflow-hidden p-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.public_url!} alt="" className="aspect-square w-full bg-surface2 object-contain" />
      </div>
      {withUrl.length > 1 && (
        <div className="scroll-thin mt-3 flex gap-2 overflow-x-auto pb-1">
          {withUrl.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === active ? 'border-accent' : 'border-line hover:border-faint'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.public_url!} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-center text-xs text-faint">{withUrl.length} {ar ? 'صورة' : 'images'}</p>
    </div>
  );
}
