import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (.next/standalone).
  output: 'standalone',
  // Allow importing the shared, canonical provider layer from ../integrations
  // (the single place all database/Gemini/Meta calls live). See README.
  experimental: {
    externalDir: true,
    // The app imports ../integrations, so file tracing must treat the repo
    // root as the project root or standalone output would miss those files.
    outputFileTracingRoot: path.join(__dirname, '..'),
  },
  // Keep lint out of the production build path (run `npm run lint` separately).
  eslint: { ignoreDuringBuilds: true },
  images: {
    // Product/campaign images are served from our own media host; the scraper
    // CDN appears only in admin-side review screens.
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack: (config) => {
    // The shared ../integrations modules import bare packages (e.g. kysely, pg)
    // that live in THIS app's node_modules. Since those files sit outside the
    // app root, add our node_modules to the resolver.
    config.resolve.modules = [
      path.join(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];
    return config;
  },
};

export default nextConfig;
