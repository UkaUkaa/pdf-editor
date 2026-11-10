// Draws the application icon (build/icon.png, 1024×1024) without any dependency.
// electron-builder derives the .icns and .ico files from it.
import { mkdir, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 1024;
const SAMPLES = 3; // per axis, for smooth edges

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative inside. */
function roundedRect(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x - cx) - (halfWidth - radius);
  const dy = Math.abs(y - cy) - (halfHeight - radius);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
}

// The sheet of paper: a rectangle with its top-right corner folded over.
const SHEET = { cx: 512, cy: 512, halfWidth: 210, halfHeight: 280, radius: 28, fold: 120 };
const LINES = [
  { y: 470, from: 362, to: 662 },
  { y: 540, from: 362, to: 662 },
  { y: 610, from: 362, to: 560 },
];

/** Colour of one sample point as [r, g, b, a]. */
function sample(x, y) {
  // Background plate with the margin macOS icons are expected to have.
  if (roundedRect(x, y, 512, 512, 412, 412, 185) > 0) return [0, 0, 0, 0];
  let color = [201 - (y / SIZE) * 30, 42, 32, 255];

  const inSheet = roundedRect(x, y, SHEET.cx, SHEET.cy, SHEET.halfWidth, SHEET.halfHeight, SHEET.radius) <= 0;
  const right = SHEET.cx + SHEET.halfWidth;
  const top = SHEET.cy - SHEET.halfHeight;
  // Distance past the diagonal that cuts the corner off.
  const cut = x - (right - SHEET.fold) - (y - top);
  if (inSheet && cut <= 0) {
    color = [255, 255, 255, 255];
    for (const line of LINES) {
      if (roundedRect(x, y, (line.from + line.to) / 2, line.y, (line.to - line.from) / 2, 14, 14) <= 0) color = [201, 42, 32, 255];
    }
    // The headline bar.
    if (roundedRect(x, y, 452, 380, 90, 26, 12) <= 0) color = [120, 24, 18, 255];
  } else if (inSheet && x <= right && y >= top && x >= right - SHEET.fold && y <= top + SHEET.fold && cut > 0 && cut < SHEET.fold * 2) {
    // The folded corner, mirrored back onto the sheet.
    if (x - (right - SHEET.fold) <= SHEET.fold - (top + SHEET.fold - y) + SHEET.fold && y - top >= x - (right - SHEET.fold)) color = [255, 214, 208, 255];
  }
  return color;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const [r, g, b, a] = sample(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
        // Premultiplied, so transparent samples do not darken the edge.
        sum[0] += r * a;
        sum[1] += g * a;
        sum[2] += b * a;
        sum[3] += a;
      }
    }
    const offset = (y * SIZE + x) * 4;
    const alpha = sum[3] / (SAMPLES * SAMPLES);
    pixels[offset] = sum[3] ? Math.round(sum[0] / sum[3]) : 0;
    pixels[offset + 1] = sum[3] ? Math.round(sum[1] / sum[3]) : 0;
    pixels[offset + 2] = sum[3] ? Math.round(sum[2] / sum[3]) : 0;
    pixels[offset + 3] = Math.round(alpha);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA
const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  pixels.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

await mkdir('build', { recursive: true });
await writeFile('build/icon.png', png);
process.stdout.write(`build/icon.png written (${png.length} bytes)\n`);
