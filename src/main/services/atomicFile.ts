import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a file atomically: the data goes to a temporary sibling file, is
 * flushed to disk and only then renamed over the target. A crash mid-write
 * leaves the previous file intact.
 */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temp, 'w', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
