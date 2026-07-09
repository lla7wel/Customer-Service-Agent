import type { Config } from 'tailwindcss';

/**
 * Theme is driven by CSS variables (see globals.css) so light + dark are a single
 * source of truth. Colors are stored as "R G B" channels and consumed with
 * <alpha-value> so opacity modifiers (e.g. bg-accent/10) work everywhere.
 */
const withAlpha = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: withAlpha('--bg'),
        surface: withAlpha('--surface'),
        surface2: withAlpha('--surface-2'),
        elevated: withAlpha('--elevated'),
        line: withAlpha('--line'),
        fg: withAlpha('--fg'),
        muted: withAlpha('--muted'),
        faint: withAlpha('--faint'),
        accent: withAlpha('--accent'),
        accent2: withAlpha('--accent-2'),
        success: withAlpha('--success'),
        warning: withAlpha('--warning'),
        danger: withAlpha('--danger'),
        info: withAlpha('--info'),
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.5rem',
        '2xl': '0.75rem',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 6px 18px -12px rgb(0 0 0 / 0.18)',
        'card-dark': '0 1px 0 rgb(255 255 255 / 0.04) inset, 0 18px 44px -26px rgb(0 0 0 / 0.9)',
        glass: '0 1px 0 rgb(255 255 255 / 0.05) inset, 0 20px 50px -28px rgb(0 0 0 / 0.7), 0 2px 8px -4px rgb(0 0 0 / 0.25)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.28), 0 16px 40px -20px rgb(var(--accent) / 0.45)',
      },
      backgroundImage: {
        'accent-grad': 'linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--accent-2)) 100%)',
        'surface-grad': 'linear-gradient(180deg, rgb(var(--surface)) 0%, rgb(var(--bg)) 100%)',
        'gold-sheen': 'linear-gradient(120deg, rgb(var(--accent) / 0.0) 30%, rgb(var(--accent) / 0.14) 50%, rgb(var(--accent) / 0.0) 70%)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        pulse2: 'pulse2 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
