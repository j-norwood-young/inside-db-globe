import { env } from '$env/dynamic/public';

export const prerender = true;

// one page; needs PUBLIC_SITE_URL at build time for absolute URLs
export function GET() {
  const site = env.PUBLIC_SITE_URL ?? '';
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}/</loc><lastmod>2026-11-24</lastmod></url>
</urlset>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
