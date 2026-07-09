import Link from 'next/link';
import { Card, SectionTitle, Badge } from '@/components/ui';
import { Cable } from 'lucide-react';
import type { IntegrationStatus } from '@integrations/status';
import type { Locale } from '@/lib/i18n/config';

export default function SystemStatus({ statuses, locale }: { statuses: IntegrationStatus[]; locale: Locale }) {
  const ar = locale === 'ar';
  return (
    <Card>
      <SectionTitle icon={Cable} title={ar ? 'الأنظمة المربوطة' : 'Connected systems'} />
      <ul className="space-y-2">
        {statuses.map((s) => (
          <li key={s.key} className="flex items-center justify-between rounded-lg border border-line bg-surface2 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 rounded-full ${s.configured ? 'bg-success' : 'bg-faint'} ${s.configured ? 'shadow-[0_0_8px] shadow-success/60' : ''}`} />
              <span className="text-sm font-medium text-fg">{s.label}</span>
            </div>
            {s.configured ? (
              <Badge tone="good">{ar ? 'مربوط' : 'Connected'}</Badge>
            ) : (
              <Link href="/settings">
                <Badge tone="warn">{ar ? 'إعداد' : 'Setup'}</Badge>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
