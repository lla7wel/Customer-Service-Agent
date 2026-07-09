import { FlaskConical, ShieldCheck, Sparkles } from 'lucide-react';
import { PageHeader, Notice, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { geminiStatus } from '@integrations/status';
import Playground from '@/components/ai/Playground';

export const dynamic = 'force-dynamic';

export default function AiPlaygroundPage() {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const status = geminiStatus();

  return (
    <div>
      <PageHeader icon={FlaskConical} title={t('nav_ai_playground')} subtitle={ar ? 'للتجربة فقط — لا يُرسل شيء للعملاء' : 'Testing only — nothing is sent to customers'} />
      <section className="command-surface mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Sparkles size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'مختبر قرارات الذكاء' : 'AI decision bench'}</p>
            <p className="text-xs text-muted">{ar ? 'اختبر الردود، مطابقة الصور، والكابشن بدون إرسال أي شيء.' : 'Test replies, image matching, and campaign copy without sending anything.'}</p>
          </div>
        </div>
        <div className="relative"><Badge tone="accent" dot>{ar ? 'بيئة آمنة' : 'Sandbox only'}</Badge></div>
      </section>
      <div className="mb-4">
        <Notice icon={ShieldCheck}>{ar ? 'مختبر آمن للاختبار فقط. لا تُرسل أي رسالة أو منشور للعملاء.' : 'A safe sandbox for testing only. Nothing is ever sent to customers.'}</Notice>
      </div>
      {!status.configured ? <NotConnected status={status} /> : <Playground locale={locale} />}
    </div>
  );
}
