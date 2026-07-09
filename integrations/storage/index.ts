/**
 * Media storage: files on local disk under MEDIA_ROOT, served publicly by the
 * reverse proxy (Caddy) at PUBLIC_MEDIA_BASE_URL. Object paths are the same
 * keys the app has always stored in *.storage_path (e.g. products/CODE/1.jpg),
 * so the database needs no path rewrite — only public_url changes host.
 *
 * Meta requires public HTTPS URLs for images sent to customers; the proxy
 * provides that. Returns {ok:false, reason:'not_configured'} instead of
 * throwing when the env is missing, matching the rest of integrations/.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { envAny } from '../env';

export interface StoredObject {
  path: string;
  publicUrl: string;
}

export function mediaRoot(): string | undefined {
  return envAny('MEDIA_ROOT');
}

export function publicMediaBaseUrl(): string | undefined {
  const base = envAny('PUBLIC_MEDIA_BASE_URL');
  return base ? base.replace(/\/+$/, '') : undefined;
}

export function isStorageConfigured(): boolean {
  return !!mediaRoot() && !!publicMediaBaseUrl();
}

/** Public URL for an object path, or null when storage is unconfigured. */
export function publicUrl(objectPath: string): string | null {
  const base = publicMediaBaseUrl();
  if (!base) return null;
  return `${base}/${objectPath.replace(/^\/+/, '')}`;
}

/** Reject traversal and absolute paths before they touch the filesystem. */
function safeJoin(root: string, objectPath: string): string | null {
  const clean = objectPath.replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  return abs;
}

export async function putObject(
  objectPath: string,
  bytes: Buffer | Uint8Array,
): Promise<{ ok: true; data: StoredObject } | { ok: false; reason: string }> {
  const root = mediaRoot();
  const url = publicUrl(objectPath);
  if (!root || !url) return { ok: false, reason: 'not_configured' };
  const abs = safeJoin(root, objectPath);
  if (!abs) return { ok: false, reason: 'invalid_path' };
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
    return { ok: true, data: { path: objectPath.replace(/^\/+/, ''), publicUrl: url } };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'write_failed' };
  }
}

export async function removeObject(objectPath: string): Promise<{ ok: boolean; reason?: string }> {
  const root = mediaRoot();
  if (!root) return { ok: false, reason: 'not_configured' };
  const abs = safeJoin(root, objectPath);
  if (!abs) return { ok: false, reason: 'invalid_path' };
  try {
    await fs.unlink(abs);
    return { ok: true };
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { ok: true };
    return { ok: false, reason: e?.message ?? 'delete_failed' };
  }
}
