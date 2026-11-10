import { isAbsolute, resolve } from 'node:path';
import { MAX_PATHS_PER_REQUEST } from '@shared/types/document';
import { isDocumentPath } from './pdfFiles';

/**
 * Picks the documents to open out of a command line ("Open with", double
 * click on Windows and Linux, a second launch of the application). Options,
 * the executable itself and anything that is not a `.pdf` / `.pdfproject`
 * path are ignored; the files are still validated when they are read.
 */
export function documentPathsFromArgv(argv: readonly string[], workingDirectory: string): string[] {
  const paths: string[] = [];
  for (const argument of argv.slice(1)) {
    if (argument.startsWith('-') || argument.includes('\0')) continue;
    const path = isAbsolute(argument) ? argument : resolve(workingDirectory, argument);
    if (isDocumentPath(path) && !paths.includes(path)) paths.push(path);
  }
  return paths.slice(0, MAX_PATHS_PER_REQUEST);
}

/**
 * Files the operating system asked the application to open. They are handed to
 * the window as soon as it can take them; until then they wait here.
 */
export class OpenRequestQueue {
  private pending: string[] = [];
  private deliver: ((paths: string[]) => void) | null = null;

  add(paths: readonly string[]): void {
    const fresh = paths.filter((path) => isDocumentPath(path));
    if (fresh.length === 0) return;
    if (this.deliver) this.deliver(fresh);
    else this.pending = [...this.pending, ...fresh].slice(-MAX_PATHS_PER_REQUEST);
  }

  /** Called when a window is ready to receive requests as they arrive. */
  connect(deliver: (paths: string[]) => void): void {
    this.deliver = deliver;
  }

  disconnect(): void {
    this.deliver = null;
  }

  /** Returns what arrived before the window was ready, once. */
  take(): string[] {
    const paths = this.pending;
    this.pending = [];
    return paths;
  }
}
