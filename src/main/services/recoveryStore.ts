import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { RecoveryEntry } from '@shared/types/document';
import { writeFileAtomic } from './atomicFile';
import { hasZipHeader } from './pdfFiles';

/** Ids become file names, so their alphabet is restricted. */
export const RECOVERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const metaSchema = z.object({
  id: z.string().regex(RECOVERY_ID_PATTERN),
  name: z.string().max(300),
  path: z.string().min(1).max(4096).nullable(),
  savedAt: z.number().finite(),
});
type RecoveryMeta = z.infer<typeof metaSchema>;

const DATA_SUFFIX = '.pdfproject';
const META_SUFFIX = '.json';

/**
 * Copies of documents with unsaved changes, written periodically by the
 * renderer as project archives. After a clean exit the folder is empty; after
 * a crash it holds the last autosaved state of every modified document.
 *
 * Copies written in the current session are told apart from those left by an
 * earlier one: only the latter are offered for recovery, and only the former
 * are deleted when the window closes normally.
 */
export class RecoveryStore {
  private readonly session = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly directory: string,
    private readonly onWarning: (message: string) => void = () => undefined,
  ) {}

  private dataPath(id: string): string {
    return join(this.directory, `${id}${DATA_SUFFIX}`);
  }

  private metaPath(id: string): string {
    return join(this.directory, `${id}${META_SUFFIX}`);
  }

  /** Operations run one after another, so a removal never races a write of the same entry. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Creates the folder and clears temporary files of writes interrupted by a crash. */
  async prepare(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true });
      for (const name of await readdir(this.directory)) {
        if (name.endsWith('.tmp')) await rm(join(this.directory, name), { force: true });
      }
    } catch (error) {
      this.onWarning(`Cannot prepare the recovery folder: ${String(error)}`);
    }
  }

  private async readMeta(id: string): Promise<RecoveryMeta | null> {
    try {
      const meta = metaSchema.parse(JSON.parse(await readFile(this.metaPath(id), 'utf8')));
      return meta.id === id ? meta : null;
    } catch {
      return null;
    }
  }

  /** Entries left by an earlier session, newest first. Incomplete or damaged ones are skipped. */
  listLeftOver(): Promise<RecoveryEntry[]> {
    return this.enqueue(async () => {
      let names: string[];
      try {
        names = await readdir(this.directory);
      } catch {
        return [];
      }
      const entries: RecoveryEntry[] = [];
      for (const name of names) {
        if (!name.endsWith(META_SUFFIX)) continue;
        const id = name.slice(0, -META_SUFFIX.length);
        if (!RECOVERY_ID_PATTERN.test(id) || this.session.has(id)) continue;
        const meta = await this.readMeta(id);
        const size = await stat(this.dataPath(id)).then(
          (stats) => (stats.isFile() ? stats.size : 0),
          () => 0,
        );
        if (meta && size > 0) entries.push({ ...meta, size });
      }
      return entries.sort((a, b) => b.savedAt - a.savedAt);
    });
  }

  write(entry: { id: string; name: string; path: string | null }, data: Uint8Array, now = Date.now()): Promise<boolean> {
    if (!RECOVERY_ID_PATTERN.test(entry.id) || !hasZipHeader(data)) return Promise.resolve(false);
    return this.enqueue(async () => {
      try {
        // The data first: an entry is only listed once its description exists.
        await writeFileAtomic(this.dataPath(entry.id), data);
        const meta: RecoveryMeta = { id: entry.id, name: entry.name, path: entry.path, savedAt: now };
        await writeFileAtomic(this.metaPath(entry.id), JSON.stringify(meta));
        this.session.add(entry.id);
        return true;
      } catch (error) {
        this.onWarning(`Cannot write a recovery copy: ${String(error)}`);
        return false;
      }
    });
  }

  read(id: string): Promise<{ entry: RecoveryMeta; data: Uint8Array } | null> {
    if (!RECOVERY_ID_PATTERN.test(id)) return Promise.resolve(null);
    return this.enqueue(async () => {
      const entry = await this.readMeta(id);
      if (!entry) return null;
      try {
        const data = await readFile(this.dataPath(id));
        return hasZipHeader(data) ? { entry, data: new Uint8Array(data) } : null;
      } catch {
        return null;
      }
    });
  }

  remove(id: string): Promise<void> {
    if (!RECOVERY_ID_PATTERN.test(id)) return Promise.resolve();
    return this.enqueue(async () => {
      this.session.delete(id);
      // The description first, so a half-removed entry is never listed.
      await rm(this.metaPath(id), { force: true }).catch(() => undefined);
      await rm(this.dataPath(id), { force: true }).catch(() => undefined);
    });
  }

  /** Removes the copies written in this session; those of earlier sessions stay until the user decides. */
  async removeSession(): Promise<void> {
    await Promise.all([...this.session].map((id) => this.remove(id)));
  }
}
