const VERIFICATION_CODE = '70t4mpxdj37vynq0mpqieznjwvtxgf';

/** Exact public response required by Meta Business domain verification. */
export function GET() {
  return new Response(VERIFICATION_CODE, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
