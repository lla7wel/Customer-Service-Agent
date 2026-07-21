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
  },
  // The app imports ../integrations, so file tracing must treat the repo
  // root as the project root or standalone output would miss those files.
  outputFileTracingRoot: path.join(__dirname, '..'),
  // Native/binary packages must load from node_modules at runtime instead of
  // being bundled (resvg ships a .node binding; jimp reads asset files).
  serverExternalPackages: ['@resvg/resvg-js', 'jimp'],
  images: {
    // Product/campaign images are served from our own media host; the scraper
    // CDN appears only in admin-side review screens.
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  turbopack: {
    // Monorepo-style root: the app imports ../integrations, whose bare imports
    // (kysely, pg, jimp) resolve from the repo-root node_modules.
    root: path.join(__dirname, '..'),
  },
};

export default nextConfig;
