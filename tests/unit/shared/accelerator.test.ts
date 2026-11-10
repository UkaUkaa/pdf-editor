import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, getCommand } from '@shared/menu/commands';
import { formatAccelerator, matchesAccelerator, parseAccelerator, type KeyEventLike } from '@shared/utils/accelerator';

const key = (value: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('accelerators', () => {
  it('maps CmdOrCtrl per platform', () => {
    expect(parseAccelerator('CmdOrCtrl+S', true)).toMatchObject({ meta: true, ctrl: false, key: 'S' });
    expect(parseAccelerator('CmdOrCtrl+S', false)).toMatchObject({ meta: false, ctrl: true, key: 'S' });
  });

  it('matches keyboard events exactly', () => {
    expect(matchesAccelerator(key('s', { ctrlKey: true }), 'CmdOrCtrl+S', false)).toBe(true);
    expect(matchesAccelerator(key('S', { ctrlKey: true, shiftKey: true }), 'CmdOrCtrl+S', false)).toBe(false);
    expect(matchesAccelerator(key('S', { ctrlKey: true, shiftKey: true }), 'CmdOrCtrl+Shift+S', false)).toBe(true);
    expect(matchesAccelerator(key('s'), 'CmdOrCtrl+S', false)).toBe(false);
    expect(matchesAccelerator(key('F11'), 'F11', false)).toBe(true);
    expect(matchesAccelerator(key(',', { ctrlKey: true }), 'CmdOrCtrl+,', false)).toBe(true);
  });

  it('treats both "=" and "+" as zoom in', () => {
    expect(matchesAccelerator(key('=', { ctrlKey: true }), 'CmdOrCtrl+Plus', false)).toBe(true);
    expect(matchesAccelerator(key('+', { ctrlKey: true, shiftKey: true }), 'CmdOrCtrl+Plus', false)).toBe(true);
  });

  it('formats for display', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatAccelerator('CmdOrCtrl+Shift+S', true)).toBe('⇧⌘S');
    expect(formatAccelerator('CmdOrCtrl+Plus', false)).toBe('Ctrl++');
  });

  it('every command accelerator is parseable and unique', () => {
    const seen = new Map<string, string>();
    for (const id of COMMAND_IDS) {
      const { accelerator } = getCommand(id);
      if (!accelerator) continue;
      expect(() => parseAccelerator(accelerator, false)).not.toThrow();
      expect(seen.get(accelerator), `${accelerator} used by ${id} and ${seen.get(accelerator)}`).toBeUndefined();
      seen.set(accelerator, id);
    }
  });
});
