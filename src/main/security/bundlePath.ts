import { extname, join, normalize, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Maps the path of an `app://bundle/...` URL to a file inside the renderer
 * bundle. Returns `null` for anything that would escape the bundle directory.
 */
export function resolveBundlePath(root: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded;
  const normalizedRoot = normalize(root);
  const target = normalize(join(normalizedRoot, relative));
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) return null;
  if (target === normalizedRoot) return null;
  return target;
}

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
