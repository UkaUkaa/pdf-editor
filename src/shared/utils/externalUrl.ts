/** Schemes that may be handed to the operating system when the user chooses to open a link. */
const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/**
 * Normalises a link target typed by the user or read from a PDF. Returns
 * `null` for anything that is not a plain web or mail address: files, scripts
 * and application-specific schemes are never opened.
 */
export function safeExternalUrl(input: string): string | null {
  const trimmed = input.trim();
  // eslint-disable-next-line no-control-regex
  if (trimmed === '' || trimmed.length > 2048 || /[\u0000-\u001f\s]/.test(trimmed)) return null;
  // "example.com/page" is what people type; treat it as https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}
