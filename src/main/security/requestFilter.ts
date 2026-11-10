/**
 * The packaged application never talks to the network: everything it needs is
 * in its own bundle. Requests are checked here in addition to the content
 * security policy, so a mistake in one layer is caught by the other.
 */
const LOCAL_PROTOCOLS = new Set(['app:', 'blob:', 'data:', 'devtools:', 'chrome-extension:']);

/** Whether a request made by the renderer session may proceed. */
export function isAllowedRequestUrl(url: string, devServerOrigin?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_PROTOCOLS.has(parsed.protocol)) return true;
  if (!devServerOrigin) return false;
  // Development only: the Vite server and its hot-reload websocket.
  const dev = new URL(devServerOrigin);
  return parsed.host === dev.host && ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
}
