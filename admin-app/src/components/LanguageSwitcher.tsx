'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/config';

/** Switches the admin UI language, persists a cookie, refreshes for RTL/LTR. */
export default function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function setLocale(next: Locale) {
    if (next === locale) return;
    setPending(true);
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
    setTimeout(() => setPending(false), 400);
  }

  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-line bg-surface p-0.5 text-xs">
      {(['ar', 'en'] as Locale[]).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          disabled={pending}
          className={`h-8 rounded-md px-2.5 font-medium transition ${
            locale === l ? 'bg-surface2 text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {l === 'ar' ? 'ع' : 'EN'}
        </button>
      ))}
    </div>
  );
}
