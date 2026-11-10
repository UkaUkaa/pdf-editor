/** Parsing, matching and display formatting of Electron-style accelerators. */

export interface ParsedAccelerator {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalised key: single upper-case character or a named key such as `F11`. */
  key: string;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function parseAccelerator(accelerator: string, isMac: boolean): ParsedAccelerator {
  // A trailing "+" key is written as "Plus" in Electron accelerators, so a plain split is safe.
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const parsed: ParsedAccelerator = { ctrl: false, meta: false, alt: false, shift: false, key: normaliseKey(key) };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'cmdorctrl':
      case 'commandorcontrol':
        if (isMac) parsed.meta = true;
        else parsed.ctrl = true;
        break;
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
        parsed.meta = true;
        break;
      case 'ctrl':
      case 'control':
        parsed.ctrl = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      default:
        throw new Error(`Unknown accelerator modifier "${part}" in "${accelerator}"`);
    }
  }
  return parsed;
}

function normaliseKey(key: string): string {
  if (key.toLowerCase() === 'plus') return '+';
  return key.length === 1 ? key.toUpperCase() : key;
}

function eventKey(event: KeyEventLike): string {
  // "=" and "+" share a physical key on most layouts; treat both as zoom-in.
  if (event.key === '=') return '+';
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function matchesAccelerator(event: KeyEventLike, accelerator: string, isMac: boolean): boolean {
  const parsed = parseAccelerator(accelerator, isMac);
  const key = eventKey(event);
  // Shift is implied when typing "+", so it is not compared for that key.
  const shiftMatches = parsed.key === '+' ? true : event.shiftKey === parsed.shift;
  return (
    key === parsed.key &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    shiftMatches
  );
}

export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const parsed = parseAccelerator(accelerator, isMac);
  if (isMac) {
    return [parsed.ctrl ? '⌃' : '', parsed.alt ? '⌥' : '', parsed.shift ? '⇧' : '', parsed.meta ? '⌘' : '', parsed.key].join(
      '',
    );
  }
  return [parsed.ctrl ? 'Ctrl' : '', parsed.meta ? 'Win' : '', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '', parsed.key]
    .filter(Boolean)
    .join('+');
}
