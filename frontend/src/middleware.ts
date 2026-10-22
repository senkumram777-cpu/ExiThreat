import { NextRequest, NextResponse } from 'next/server';

// The site is served at two addresses on iyugam.com: the members' site and, for ProMic's
// admin, the admin page on its own subdomain. Other addresses (exithreat.fly.dev, localhost)
// serve everything as before.
const SITE_HOST = 'exithreat.iyugam.com';
const ADMIN_HOST = 'exithreat-admin.iyugam.com';

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const { pathname, search } = req.nextUrl;
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  if (host === ADMIN_HOST && !isAdminPath) {
    // The admin subdomain opens on the admin page; members' pages live on the site.
    const target = pathname === '/' ? `https://${ADMIN_HOST}/admin` : `https://${SITE_HOST}${pathname}${search}`;
    return NextResponse.redirect(target, 307);
  }
  if (host === SITE_HOST && isAdminPath) {
    return NextResponse.redirect(`https://${ADMIN_HOST}${pathname}${search}`, 307);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: not Next's own files, the service worker, the manifest, icons or the offline page.
  matcher: ['/((?!_next/|api/|icons/|sw\\.js|workbox-|fallback-|manifest\\.json|icon\\.png|favicon\\.ico|offline).*)'],
};
