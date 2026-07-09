import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing the shared, canonical provider layer from ../integrations
  // (the single place all Gemini/Meta/Supabase calls live). See README.
  experimental: {
    externalDir: true,
  },
  // Keep lint out of the production build path (run `npm run lint` separately).
  eslint: { ignoreDuringBuilds: true },
  images: {
    // Product/campaign images come from Supabase Storage + scraper sources.
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack: (config) => {
    // The shared ../integrations modules import bare packages (e.g.
    // @supabase/supabase-js) that live in THIS app's node_modules. Since those
    // files sit outside the app root, add our node_modules to the resolver.
    config.resolve.modules = [
      path.join(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
};

export default nextConfig;
