import { describe, expect, it } from 'vitest';
import { documentPathsFromArgv, OpenRequestQueue } from '../../../src/main/services/openRequests';

describe('documentPathsFromArgv', () => {
  it('keeps only document paths and resolves relative ones', () => {
    const argv = ['/Applications/PDF Editor', '--inspect=9229', '/docs/a.pdf', 'b.PDFPROJECT', '/docs/notes.txt', '-x', '/docs/a.pdf', 'evil\0.pdf'];
    expect(documentPathsFromArgv(argv, '/home/user')).toEqual(['/docs/a.pdf', '/home/user/b.PDFPROJECT']);
  });

  it('never treats the executable itself as a document and limits the number of files', () => {
    expect(documentPathsFromArgv(['/opt/viewer.pdf'], '/')).toEqual([]);
    const many = ['app', ...Array.from({ length: 200 }, (_, index) => `/d/${index}.pdf`)];
    expect(documentPathsFromArgv(many, '/')).toHaveLength(64);
  });
});

describe('OpenRequestQueue', () => {
  it('holds requests until a window takes them, then delivers directly', () => {
    const queue = new OpenRequestQueue();
    queue.add(['/docs/early.pdf', '/docs/ignored.exe', 'relative.pdf']);
    queue.add(['/docs/second.pdfproject']);
    expect(queue.take()).toEqual(['/docs/early.pdf', '/docs/second.pdfproject']);
    expect(queue.take()).toEqual([]);

    const delivered: string[][] = [];
    queue.connect((paths) => delivered.push(paths));
    queue.add(['/docs/later.pdf']);
    queue.add(['/docs/nothing.txt']);
    expect(delivered).toEqual([['/docs/later.pdf']]);

    // Without a window requests wait again.
    queue.disconnect();
    queue.add(['/docs/waiting.pdf']);
    expect(queue.take()).toEqual(['/docs/waiting.pdf']);
  });
});
