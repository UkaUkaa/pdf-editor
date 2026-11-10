// Generates the PDF files used by automated tests into tests/fixtures/.
// Run with `npm run fixtures`; the output is deterministic enough to commit.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
await mkdir(out, { recursive: true });

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

async function newDocument(title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  return pdf;
}

/** Three pages: A4 portrait, US Letter landscape, A4 with /Rotate 90. Each has a coloured corner marker. */
async function mixedPages() {
  const pdf = await newDocument('Mixed pages');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const specs = [
    { size: [595.28, 841.89], rotate: 0, color: rgb(0.86, 0.15, 0.15), label: 'Page 1 - A4 portrait' },
    { size: [792, 612], rotate: 0, color: rgb(0.1, 0.6, 0.2), label: 'Page 2 - Letter landscape' },
    { size: [595.28, 841.89], rotate: 90, color: rgb(0.15, 0.3, 0.85), label: 'Page 3 - A4 rotated 90' },
  ];
  for (const spec of specs) {
    const page = pdf.addPage(spec.size);
    page.setRotation(degrees(spec.rotate));
    const { width, height } = page.getSize();
    // Solid block in the top-left corner of the unrotated page.
    page.drawRectangle({ x: 0, y: height - 200, width: 200, height: 200, color: spec.color });
    page.drawText(spec.label, { x: 60, y: height / 2, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });
  }
  return pdf.save();
}

/** Sixty identical-size pages for virtualisation and navigation tests. */
async function manyPages() {
  const pdf = await newDocument('Many pages');
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 1; index <= 60; index += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(String(index), { x: 240, y: 380, size: 120, font, color: rgb(0.2, 0.2, 0.2) });
  }
  return pdf.save();
}

// --- A minimal RC4-40 encrypted PDF (standard security handler, revision 2) ---------------
// pdf-lib cannot encrypt, so the file is assembled by hand. User password: "secret".

const PAD = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPassword = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const result = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    result[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return result;
}

function encryptedPdf(userPassword, ownerPassword) {
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);

  const ownerKey = md5(padPassword(ownerPassword)).subarray(0, 5);
  const o = rc4(ownerKey, padPassword(userPassword));
  const key = md5(padPassword(userPassword), o, permissions, id).subarray(0, 5);
  const u = rc4(key, PAD);

  const objectKey = (number) => md5(key, Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = Buffer.from('BT /F1 36 Tf 72 700 Td (Encrypted fixture) Tj ET\n0.9 0.5 0.1 rg 72 500 200 100 re f\n', 'latin1');
  const encryptedContent = rc4(objectKey(4), content);
  const hex = (buffer) => `<${buffer.toString('hex')}>`;

  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`), encryptedContent, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O ${hex(o)} /U ${hex(u)} /P -4 >>`),
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    position += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${position}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

await writeFile(join(out, 'mixed-pages.pdf'), await mixedPages());
await writeFile(join(out, 'many-pages.pdf'), await manyPages());
await writeFile(join(out, 'encrypted.pdf'), encryptedPdf('secret', 'owner'));
await writeFile(join(out, 'not-a-pdf.pdf'), 'This file has a .pdf extension but is plain text.\n');
await writeFile(join(out, 'corrupt.pdf'), '%PDF-1.7\nthis is not a real document structure\n');
