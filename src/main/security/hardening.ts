import { readFile } from 'node:fs/promises';
import { app, protocol, session, type WebFrameMain } from 'electron';
import { APP_HOST, APP_ORIGIN, APP_PROTOCOL } from '@shared/constants/ipc';
import { mimeTypeFor, resolveBundlePath } from './bundlePath';
import { isAllowedRequestUrl } from './requestFilter';

/** Dev-server origin (electron-vite sets this variable in `dev` mode only). */
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'] || undefined;

export const RENDERER_URL = DEV_SERVER_URL ?? `${APP_ORIGIN}/index.html`;
const TRUSTED_ORIGIN = new URL(RENDERER_URL).origin === 'null' ? APP_ORIGIN : new URL(RENDERER_URL).origin;

const PRODUCTION_CSP = [
  "default-src 'none'",
  // 'wasm-unsafe-eval' lets PDF.js run its image decoders (JPEG 2000, JBIG2, colour management).
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The Vite dev server needs inline preamble scripts, injected styles and a websocket for HMR. */
function developmentCsp(devOrigin: string): string {
  const ws = devOrigin.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    `connect-src 'self' ${ws}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);
}

/** Serves the renderer bundle from `app://bundle/` with a strict CSP. */
export function installAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST || request.method !== 'GET') {
      return new Response(null, { status: 404 });
    }
    const filePath = resolveBundlePath(rendererRoot, url.pathname);
    if (!filePath) return new Response(null, { status: 403 });
    try {
      const body = await readFile(filePath);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': mimeTypeFor(filePath),
          'Content-Security-Policy': PRODUCTION_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export function isTrustedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${APP_PROTOCOL}:`) return parsed.host === APP_HOST && TRUSTED_ORIGIN === APP_ORIGIN;
    return parsed.origin === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

/** IPC is only accepted from the top-level frame of our own renderer bundle. */
export function isTrustedSender(frame: WebFrameMain | null): boolean {
  return frame !== null && frame.parent === null && isTrustedUrl(frame.url);
}

export function installSessionHardening(): void {
  const defaultSession = session.defaultSession;

  // No web permission (camera, geolocation, notifications…) is ever granted.
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);

  // Nothing but the application's own bundle is ever requested: no telemetry, no updates,
  // no remote content. A PDF cannot make the application reach out either.
  const devOrigin = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : undefined;
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequestUrl(details.url, devOrigin) });
  });

  if (DEV_SERVER_URL) {
    const csp = developmentCsp(new URL(DEV_SERVER_URL).origin);
    defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }

  app.on('web-contents-created', (_event, contents) => {
    // The application never opens secondary windows or navigates away from its bundle.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
