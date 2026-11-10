import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../services/atomicFile';

const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(640).max(16384),
  height: z.number().int().min(480).max(16384),
  maximized: z.boolean(),
});

export type WindowState = z.infer<typeof windowStateSchema>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900, maximized: false };

export function windowStateFile(directory: string): string {
  return join(directory, 'window-state.json');
}

export async function loadWindowState(directory: string): Promise<WindowState> {
  try {
    return windowStateSchema.parse(JSON.parse(await readFile(windowStateFile(directory), 'utf8')));
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export async function saveWindowState(directory: string, state: WindowState): Promise<void> {
  await writeFileAtomic(windowStateFile(directory), JSON.stringify(state, null, 2));
}

export function saveWindowStateSync(directory: string, state: WindowState): void {
  try {
    const target = windowStateFile(directory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${target}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${target}.tmp`, target);
  } catch {
    // Losing the window geometry is harmless; the defaults are used next time.
  }
}

/**
 * Drops a saved position when it is no longer visible on any connected display
 * (for example after an external monitor was unplugged).
 */
export function fitToDisplays(state: WindowState, workAreas: readonly Rect[]): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  const { x, y, width, height } = state;
  const visible = workAreas.some((area) => {
    const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
    const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
    return overlapX >= 120 && overlapY >= 80;
  });
  return visible ? state : { width, height, maximized: state.maximized };
}
