import { env } from '$env/dynamic/public';

export const prerender = true;

export function GET() {
  const site = env.PUBLIC_SITE_URL;
  const body = `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${site}/sitemap.xml\n` : ''}`;
  return new Response(body, { headers: { 'content-type': 'text/plain' } });
}
