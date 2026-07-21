/**
 * Shared helpers for the maintenance scripts.
 *
 * The scraper is no longer a system feature: there is no import, sync or
 * matching pipeline for it. Product images obtained in the past are already in
 * the catalog and are never deleted. These helpers only resolve the LOCAL file
 * path of an existing catalog image (product_images.local_path) so the
 * fingerprint generator can read bytes that were never uploaded to media
 * storage. Set LEGACY_IMAGES_DIR when those files live outside the repo.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Load EH-SYSTEM1/.env regardless of the cwd the script is run from.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../.env') });
config();

/** Absolute path of a stored catalog image, from its recorded local_path. */
export function resolveImageAbsPath(relPath: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  const imagesDir = process.env.LEGACY_IMAGES_DIR || process.env.SCRAPER_IMAGES_DIR;
  if (imagesDir) {
    const marker = `data${path.sep}images${path.sep}`;
    const idx = relPath.indexOf(marker);
    if (idx !== -1) return path.join(imagesDir, relPath.slice(idx + marker.length));
    return path.join(imagesDir, relPath);
  }
  return path.resolve(here, '..', relPath);
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
