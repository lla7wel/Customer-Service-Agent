import { describe, expect, it } from 'vitest';
import { fetchImageSafely } from '../../integrations/util/safe-fetch';

describe('SSRF-safe image fetching', () => {
  it('rejects non-http(s) protocols', async () => {
    expect((await fetchImageSafely('ftp://example.com/a.jpg')).ok).toBe(false);
    expect((await fetchImageSafely('file:///etc/passwd')).ok).toBe(false);
  });

  it('rejects invalid URLs', async () => {
    const r = await fetchImageSafely('not a url');
    expect(r).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('blocks private / reserved address ranges', async () => {
    for (const url of [
      'https://10.0.0.5/img.jpg',
      'https://192.168.1.1/img.jpg',
      'https://172.16.0.9/img.jpg',
      'https://169.254.169.254/latest/meta-data', // cloud metadata endpoint
      'https://[::1]/img.jpg',
    ]) {
      const r = await fetchImageSafely(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['private_address_blocked', 'not_an_image', 'network_error']).toContain(r.reason);
    }
  });

  it('blocks plain-http to non-local hosts', async () => {
    const r = await fetchImageSafely('http://8.8.8.8/img.jpg');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('protocol_not_allowed');
  });
});
