import { SlidersHorizontal, Info, FlaskConical, Bot } from 'lucide-react';
import Link from 'next/link';
import { PageHeader, Notice, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus, geminiStatus } from '@integrations/status';
import { fetchRows } from '@/lib/data';
import type { AiBehavior } from '@integrations/db/rows';
import AiBehaviors from '@/components/ai/AiBehaviors';

export const dynamic = 'force-dynamic';

export default async function AiControlPage() {
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const sStatus = databaseStatus();
  const gStatus = geminiStatus();

  const { connected, rows } = await fetchRows<AiBehavior>('ai_behaviors', (q) => q.orderBy('behavior_key', 'asc'));

  return (
    <div>
      <PageHeader
        icon={SlidersHorizontal}
        title={t('nav_ai_control')}
        subtitle={ar ? 'استوديو سلوك الذكاء — كل سلوك يُضبط على حدة، والتغييرات فورية' : 'AI behavior studio — configure each behavior; changes go live instantly'}
      />

      <section className="command-surface mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Bot size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'لوحة سلوك الذكاء' : 'Behavior control panel'}</p>
            <p className="text-xs text-muted">{ar ? 'تعديل نبرة وقواعد الردود من مكان واحد.' : 'Tune tone and response rules from one focused panel.'}</p>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Badge tone={gStatus.configured ? 'good' : 'warn'} dot>{gStatus.configured ? 'Gemini' : 'Gemini env'}</Badge>
          <Badge tone={connected ? 'good' : 'warn'} dot>{connected ? (ar ? 'السلوكيات' : 'Behaviors') : 'Supabase'}</Badge>
          <Link href="/ai-playground" className="btn-ghost"><FlaskConical size={15} /> {ar ? 'اختبار' : 'Test'}</Link>
        </div>
      </section>

      {!gStatus.configured && (
        <div className="mb-4"><Notice icon={Info} tone="warn">{ar ? 'حرّر القواعد الآن، لكن الردود لن تعمل حتى تضيف GEMINI_API_KEY.' : 'Edit rules now, but replies will not run until GEMINI_API_KEY is set.'}</Notice></div>
      )}

      {!connected ? (
        <NotConnected status={sStatus} />
      ) : rows.length === 0 ? (
        <Notice tone="error">{ar ? 'لا توجد سلوكيات. شغّل database/migrations/0005_ai_behaviors.sql.' : 'No behaviors found. Run database/migrations/0005_ai_behaviors.sql.'}</Notice>
      ) : (
        <AiBehaviors behaviors={rows} locale={locale} geminiConnected={gStatus.configured} />
      )}
    </div>
  );
}
