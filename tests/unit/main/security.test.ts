import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mimeTypeFor, resolveBundlePath } from '../../../src/main/security/bundlePath';
import { isAllowedRequestUrl } from '../../../src/main/security/requestFilter';
import { DEFAULT_WINDOW_STATE, fitToDisplays } from '../../../src/main/windows/windowState';

const root = resolve('/app/out/renderer');

describe('resolveBundlePath', () => {
  it('serves index.html for the root and resolves nested assets', () => {
    expect(resolveBundlePath(root, '/')).toBe(join(root, 'index.html'));
    expect(resolveBundlePath(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'));
  });

  it('rejects every attempt to leave the bundle directory', () => {
    expect(resolveBundlePath(root, '/../main/index.js')).toBeNull();
    expect(resolveBundlePath(root, '/assets/../../secret')).toBeNull();
    expect(resolveBundlePath(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveBundlePath(root, '/..%2f..%2fetc%2fpasswd')).toBeNull();
    expect(resolveBundlePath(root, '/file%00.js')).toBeNull();
    expect(resolveBundlePath(root, '/%E0%A4%A')).toBeNull();
  });

  it('does not treat a sibling directory with the same prefix as inside the bundle', () => {
    expect(resolveBundlePath(root, '/../renderer-evil/x.js')).toBeNull();
  });
});

describe('mimeTypeFor', () => {
  it('maps known extensions and falls back to a safe default', () => {
    expect(mimeTypeFor('a/index.html')).toContain('text/html');
    expect(mimeTypeFor('a/app.JS')).toContain('text/javascript');
    expect(mimeTypeFor('a/unknown.xyz')).toBe('application/octet-stream');
  });
});

describe('fitToDisplays', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('keeps a position that is visible', () => {
    const state = { x: 100, y: 100, width: 1200, height: 800, maximized: false };
    expect(fitToDisplays(state, [display])).toEqual(state);
  });

  it('drops a position on a display that no longer exists', () => {
    const state = { x: 5000, y: 100, width: 1200, height: 800, maximized: true };
    expect(fitToDisplays(state, [display])).toEqual({ width: 1200, height: 800, maximized: true });
  });

  it('leaves the default state untouched', () => {
    expect(fitToDisplays(DEFAULT_WINDOW_STATE, [display])).toEqual(DEFAULT_WINDOW_STATE);
  });
});

describe('isAllowedRequestUrl', () => {
  it('lets the application load only its own bundle and in-memory data', () => {
    expect(isAllowedRequestUrl('app://bundle/index.html')).toBe(true);
    expect(isAllowedRequestUrl('blob:app://bundle/2f1c')).toBe(true);
    expect(isAllowedRequestUrl('data:image/png;base64,AAAA')).toBe(true);
    for (const url of ['https://example.com/track', 'http://127.0.0.1:8080/', 'ws://example.com', 'file:///etc/passwd', 'ftp://example.com/x', 'not a url']) {
      expect(isAllowedRequestUrl(url), url).toBe(false);
    }
  });

  it('additionally allows the dev server, and only it, in development', () => {
    const dev = 'http://localhost:5173';
    expect(isAllowedRequestUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isAllowedRequestUrl('ws://localhost:5173/', dev)).toBe(true);
    expect(isAllowedRequestUrl('http://localhost:9999/', dev)).toBe(false);
    expect(isAllowedRequestUrl('https://example.com/', dev)).toBe(false);
    expect(isAllowedRequestUrl('file:///etc/passwd', dev)).toBe(false);
  });
});
