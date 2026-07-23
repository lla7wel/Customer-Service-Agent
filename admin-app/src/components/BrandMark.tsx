/* eslint-disable @next/next/no-img-element -- brand logo uses the configured media host */
/**
 * The English Home brand mark. Renders the official Brand Kit logo when one has
 * been uploaded; otherwise a restrained ENGLISH HOME LIBYA typographic wordmark
 * (never an invented replacement logo). Used in the shell, login and loading.
 */
export default function BrandMark({
  logoUrl,
  size = 'md',
  animate = false,
  className = '',
}: {
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  className?: string;
}) {
  const h = size === 'lg' ? 'h-11' : size === 'sm' ? 'h-7' : 'h-9';
  const reveal = animate ? 'brand-reveal' : '';
  if (logoUrl) {
    return <img src={logoUrl} alt="English Home Libya" className={`${h} w-auto object-contain ${reveal} ${className}`} />;
  }
  const big = size === 'lg' ? 'text-[15px]' : size === 'sm' ? 'text-[11px]' : 'text-[13px]';
  const small = size === 'lg' ? 'text-[10px]' : 'text-[8px]';
  return (
    <span className={`inline-flex flex-col justify-center leading-none ${reveal} ${className}`} aria-label="English Home Libya">
      <span className={`${big} font-bold tracking-[0.14em] text-fg`}>ENGLISH&nbsp;HOME</span>
      <span className={`${small} mt-0.5 font-semibold tracking-[0.42em] text-muted`}>LIBYA</span>
    </span>
  );
}
