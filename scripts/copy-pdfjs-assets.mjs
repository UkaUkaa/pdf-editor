// Copies the static resources PDF.js loads at runtime (character maps, standard
// fonts, WebAssembly decoders, ICC profiles) into the renderer's public folder,
// so they are served from the application bundle and never from the network.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'src', 'renderer', 'public', 'pdfjs');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(source, directory), join(target, directory), { recursive: true });
}

// Fonts for text objects (DejaVu: Latin + Cyrillic, embeddable). Used on screen and in exported PDFs.
const fontSource = join(root, 'node_modules', 'dejavu-fonts-ttf');
const fontTarget = join(root, 'src', 'renderer', 'public', 'fonts');
await rm(fontTarget, { recursive: true, force: true });
await mkdir(fontTarget, { recursive: true });
for (const family of ['DejaVuSans', 'DejaVuSerif', 'DejaVuSansMono']) {
  const italic = family === 'DejaVuSerif' ? 'Italic' : 'Oblique';
  for (const suffix of ['', '-Bold', `-${italic}`, `-Bold${italic}`]) {
    await cp(join(fontSource, 'ttf', `${family}${suffix}.ttf`), join(fontTarget, `${family}${suffix}.ttf`));
  }
}
await cp(join(fontSource, 'LICENSE'), join(fontTarget, 'LICENSE-DejaVu.txt'));

// OCR engine (Tesseract): the worker, the LSTM cores for the three CPU feature levels and
// compressed language data. Everything is local, so recognition works without a network.
const ocrTarget = join(root, 'src', 'renderer', 'public', 'tesseract');
await rm(ocrTarget, { recursive: true, force: true });
await mkdir(join(ocrTarget, 'lang'), { recursive: true });
await cp(join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), join(ocrTarget, 'worker.min.js'));
for (const variant of ['relaxedsimd-lstm', 'simd-lstm', 'lstm']) {
  const file = `tesseract-core-${variant}.wasm.js`;
  await cp(join(root, 'node_modules', 'tesseract.js-core', file), join(ocrTarget, file));
}
for (const language of ['eng', 'rus', 'ukr']) {
  const file = `${language}.traineddata.gz`;
  await cp(join(root, 'node_modules', '@tesseract.js-data', language, '4.0.0_best_int', file), join(ocrTarget, 'lang', file));
}
