import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { MAX_RECENT_FILES, type RecentFile } from '@shared/types/document';
import { writeFileAtomic } from './atomicFile';

const recentSchema = z.array(
  z.object({ path: z.string().min(1).max(4096), name: z.string().max(1024), openedAt: z.number() }),
);

/** Most-recently-opened documents, newest first, persisted in the user data directory. */
export class RecentFilesStore {
  readonly filePath: string;
  private entries: RecentFile[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    private readonly onWarning: (message: string) => void = () => undefined,
  ) {
    this.filePath = join(directory, 'recent-files.json');
  }

  async load(): Promise<void> {
    try {
      this.entries = recentSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8'))).slice(0, MAX_RECENT_FILES);
    } catch {
      // A missing or unreadable list is not worth interrupting the user for.
      this.entries = [];
    }
  }

  /** Returns the list without files that no longer exist on disk. */
  async list(): Promise<RecentFile[]> {
    const checks = await Promise.all(
      this.entries.map((entry) =>
        access(entry.path).then(
          () => true,
          () => false,
        ),
      ),
    );
    return this.entries.filter((_, index) => checks[index]);
  }

  async add(path: string, now = Date.now()): Promise<void> {
    this.entries = [
      { path, name: basename(path), openedAt: now },
      ...this.entries.filter((entry) => entry.path !== path),
    ].slice(0, MAX_RECENT_FILES);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.entries, null, 2);
    this.writeQueue = this.writeQueue
      .then(() => writeFileAtomic(this.filePath, snapshot))
      .catch((error) => this.onWarning(`Cannot save recent files: ${String(error)}`));
    return this.writeQueue;
  }
}
