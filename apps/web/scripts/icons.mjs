/**
 * Draws the application icons.
 *
 * The icons are generated rather than committed as binaries somebody would
 * have to take on trust, and they are drawn from the same tokens the interface
 * uses, so changing the accent colour in one place changes them too.
 *
 * Run with `pnpm --filter @neuron/web icons`. The output belongs in git: a
 * deploy must not depend on this having been run.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const tokens = readFileSync(
  new URL('../../../packages/config/tokens.css', import.meta.url),
  'utf8',
);

/**
 * Reads one colour out of the token file.
 *
 * @param {string} name the variable name, without the leading dashes
 * @returns {[number, number, number]} red, green and blue, 0 to 255
 */
function token(name) {
  const match = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i').exec(tokens);

  if (!match) {
    throw new Error(`tokens.css has no --${name}`);
  }

  const hex = match[1];

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const background = token('bg');
const accent = token('accent');
const dim = token('text-dim');

/**
 * The mark: a ring with a filled centre and three smaller nodes on it.
 *
 * @param {number} size the square edge, in pixels
 * @returns {Buffer} raw RGBA, row major
 */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const ringRadius = size * 0.3;
  const ringWidth = size * 0.045;
  const coreRadius = size * 0.085;
  const nodeRadius = size * 0.075;
  const nodes = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6].map((angle) => [
    centre + Math.cos(angle) * ringRadius,
    centre + Math.sin(angle) * ringRadius,
  ]);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const fromCentre = Math.hypot(px - centre, py - centre);

      // Start on the background, then lay each shape over it. Coverage is the
      // distance to the shape's edge clamped to one pixel, which is enough
      // anti-aliasing that the curves do not look like stairs.
      let colour = background;
      let alpha = 1;

      const ringCoverage = 1 - clamp(Math.abs(fromCentre - ringRadius) - ringWidth / 2);

      if (ringCoverage > 0) {
        [colour, alpha] = blend(colour, dim, ringCoverage * 0.9);
      }

      for (const [nx, ny] of nodes) {
        const coverage = 1 - clamp(Math.hypot(px - nx, py - ny) - nodeRadius);

        if (coverage > 0) {
          [colour, alpha] = blend(colour, accent, coverage);
        }
      }

      const coreCoverage = 1 - clamp(fromCentre - coreRadius);

      if (coreCoverage > 0) {
        [colour, alpha] = blend(colour, accent, coreCoverage);
      }

      const offset = (y * size + x) * 4;

      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/** Clamps a signed distance to the zero to one range. */
function clamp(distance) {
  return Math.min(1, Math.max(0, distance));
}

/** Lays one colour over another at the given coverage. */
function blend(under, over, coverage) {
  return [
    [
      Math.round(under[0] + (over[0] - under[0]) * coverage),
      Math.round(under[1] + (over[1] - under[1]) * coverage),
      Math.round(under[2] + (over[2] - under[2]) * coverage),
    ],
    1,
  ];
}

/**
 * Wraps raw pixels in the smallest PNG that is still a valid one.
 *
 * @param {number} size the square edge
 * @param {Buffer} pixels raw RGBA
 * @returns {Buffer} the file
 */
function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y += 1) {
    // Filter type 0, meaning the scanline is stored as it is.
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // truecolour with alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One PNG chunk: length, type, payload, checksum. */
function chunk(type, payload) {
  const length = Buffer.alloc(4);

  length.writeUInt32BE(payload.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const checksum = Buffer.alloc(4);

  checksum.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, checksum]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;

  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

for (const size of [192, 512]) {
  writeFileSync(`${publicDir}icon-${size}.png`, encodePng(size, draw(size)));
  console.log(`icon-${size}.png`);
}

// The same mark as vector, for the browser tab, where it is drawn at 16 px and
// a downscaled photograph of a circle looks like a smudge.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="rgb(${background.join(',')})"/>
  <circle cx="32" cy="32" r="19.2" fill="none" stroke="rgb(${dim.join(',')})" stroke-width="2.9"/>
  <circle cx="32" cy="32" r="5.4" fill="rgb(${accent.join(',')})"/>
  <circle cx="32" cy="12.8" r="4.8" fill="rgb(${accent.join(',')})"/>
  <circle cx="48.6" cy="41.6" r="4.8" fill="rgb(${accent.join(',')})"/>
  <circle cx="15.4" cy="41.6" r="4.8" fill="rgb(${accent.join(',')})"/>
</svg>
`;

writeFileSync(`${publicDir}icon.svg`, svg);
console.log('icon.svg');
