import { readFile } from 'node:fs/promises';
import path from 'node:path';

const contentTypes: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serve the built shell and its worker-owned assets from the live API origin. */
export async function builtShell(pathname: string): Promise<Response> {
  const asset =
    pathname.startsWith('/assets/') ||
    [
      '/sw.js',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/apple-touch-icon.png',
      '/icon-192.png',
      '/icon-512.png',
    ].includes(pathname)
      ? pathname.slice(1)
      : 'index.html';
  try {
    return new Response(await readFile(path.join(process.cwd(), 'dist', asset)), {
      headers: { 'content-type': contentTypes[path.extname(asset)] ?? 'text/html' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
