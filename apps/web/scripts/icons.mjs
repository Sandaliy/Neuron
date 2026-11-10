/**
 * Draws the application icons.
 *
 * The icons are generated rather than committed as binaries somebody would
 * have to take on trust, and their colours come from the token file, so the
 * palette stays in one place.
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

const tile = token('logo-tile');
const ink = token('logo-ink');
const accent = token('logo-dot');

/**
 * The logo: a letter N whose diagonal is a chain of dots. The dots grow as
 * they fall, and the last one is the blue foot of the right stem, which is
 * why that stem stops short.
 *
 * The diagonal runs from the top of the left stem to the centre of the blue
 * dot. The first dot touches the left stem, and the gaps between neighbours,
 * the one before the blue dot included, are equal.
 *
 * @param {object} spec
 * @param {number} spec.unit the edge of the square everything is measured on
 * @param {number} spec.radius the corner radius of the tile in the vector
 * @param {number} spec.left the centre line of the left stem
 * @param {number} spec.right the centre line of the right stem
 * @param {number} spec.top where both stems start, before the round cap
 * @param {number} spec.bottom where the left stem ends, and the blue dot's centre
 * @param {number} spec.rightBottom where the right stem ends
 * @param {number} spec.stemWidth the stroke width of both stems
 * @param {number[]} spec.radii the off-white dots, top to bottom
 * @param {number} spec.footRadius the blue dot
 */
function logo(spec) {
  const run = spec.right - spec.left;
  const fall = spec.bottom - spec.top;
  const length = Math.hypot(run, fall);
  const [ux, uy] = [run / length, fall / length];
  const sizes = [...spec.radii, spec.footRadius];

  let occupied = 0;

  for (let i = 1; i < sizes.length; i += 1) {
    occupied += sizes[i - 1] + sizes[i];
  }

  const first = (spec.stemWidth / 2 + spec.radii[0]) / ux;
  const gap = (length - first - occupied) / spec.radii.length;

  if (gap <= 0) {
    throw new Error('the dots of the diagonal overlap');
  }

  const dots = [];
  let along = first;

  spec.radii.forEach((r, i) => {
    if (i > 0) {
      along += spec.radii[i - 1] + r + gap;
    }

    dots.push({
      kind: 'dot',
      x: spec.left + ux * along,
      y: spec.top + uy * along,
      r,
      colour: ink,
    });
  });

  return {
    unit: spec.unit,
    radius: spec.radius,
    shapes: [
      { kind: 'stem', x: spec.left, top: spec.top, bottom: spec.bottom, width: spec.stemWidth },
      {
        kind: 'stem',
        x: spec.right,
        top: spec.top,
        bottom: spec.rightBottom,
        width: spec.stemWidth,
      },
      ...dots,
      { kind: 'dot', x: spec.right, y: spec.bottom, r: spec.footRadius, colour: accent },
    ].map((shape) => ({ colour: ink, ...shape })),
  };
}

/** The mark at 56 pixels and up: the README, home screens, the install prompt. */
const MARK = logo({
  unit: 64,
  radius: 14,
  left: 19,
  right: 45,
  top: 18,
  bottom: 46,
  rightBottom: 35.6,
  stemWidth: 6.4,
  radii: [3.3, 3.7, 4.1],
  footRadius: 5.2,
});

/**
 * The browser tab, drawn at 16 and 32 pixels. At those sizes the full mark's
 * 1.6 pixel stems turn grey and its dots run into them, so this one is drawn
 * on a 16 unit grid: stems two whole pixels wide, a blue dot four pixels
 * across on the pixel grid, and the letter filling more of the tile. At 16 the
 * dots blend into a diagonal, which is what keeps it an N; at 32 they separate.
 */
const FAVICON = logo({
  unit: 16,
  radius: 3.5,
  left: 4,
  right: 12,
  top: 4,
  bottom: 12,
  rightBottom: 8,
  stemWidth: 2,
  radii: [0.85, 0.95, 1],
  footRadius: 2,
});

/**
 * Android crops a maskable icon to any shape inside a circle of 40 percent of
 * the edge around the centre, so nothing of the mark may sit outside it.
 */
function assertSafeZone(design) {
  const centre = design.unit / 2;
  const limit = design.unit * 0.4;

  for (const shape of design.shapes) {
    const reach =
      shape.kind === 'stem'
        ? Math.max(
            Math.hypot(shape.x - centre, shape.top - centre),
            Math.hypot(shape.x - centre, shape.bottom - centre),
          ) +
          shape.width / 2
        : Math.hypot(shape.x - centre, shape.y - centre) + shape.r;

    if (reach > limit) {
      throw new Error(`the mark leaves the maskable safe zone (${reach.toFixed(2)} > ${limit})`);
    }
  }
}

assertSafeZone(MARK);

/** How far a point lies outside a shape, in the design's units. */
function distance(shape, x, y) {
  if (shape.kind === 'stem') {
    const dy = Math.max(shape.top - y, 0, y - shape.bottom);

    return Math.hypot(x - shape.x, dy) - shape.width / 2;
  }

  return Math.hypot(x - shape.x, y - shape.y) - shape.r;
}

/**
 * Rasterises a design as a full-bleed square. iOS and Android cut their own
 * corners into a home-screen icon and fill anything transparent with black, so
 * the tile's rounding exists only in the vector.
 *
 * @param {number} size the square edge, in pixels
 * @returns {Buffer} raw RGBA, row major
 */
function draw(size, design) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / design.unit;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;

      // Coverage is half a pixel minus the distance to the shape's edge,
      // clamped: a pixel whose centre sits on the edge is half covered.
      let colour = tile;

      for (const shape of design.shapes) {
        const coverage = clamp(0.5 - distance(shape, ux, uy) * scale);

        if (coverage > 0) {
          colour = blend(colour, shape.colour, coverage);
        }
      }

      const offset = (y * size + x) * 4;

      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

/** Clamps a coverage to the zero to one range. */
function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

/** Lays one colour over another at the given coverage. */
function blend(under, over, coverage) {
  return [
    Math.round(under[0] + (over[0] - under[0]) * coverage),
    Math.round(under[1] + (over[1] - under[1]) * coverage),
    Math.round(under[2] + (over[2] - under[2]) * coverage),
  ];
}

/** The same design as an SVG, with the tile's rounded corners. */
function vector(design) {
  const hex = (colour) => `#${colour.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const round = (n) => Math.round(n * 100) / 100;
  const shapes = design.shapes.map((shape) =>
    shape.kind === 'stem'
      ? `  <path d="M${shape.x} ${shape.bottom}V${shape.top}" stroke="${hex(shape.colour)}" stroke-width="${shape.width}" stroke-linecap="round"/>`
      : `  <circle cx="${round(shape.x)}" cy="${round(shape.y)}" r="${shape.r}" fill="${hex(shape.colour)}"/>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.unit} ${design.unit}">`,
    `  <rect width="${design.unit}" height="${design.unit}" rx="${design.radius}" fill="${hex(tile)}"/>`,
    ...shapes,
    '</svg>',
    '',
  ].join('\n');
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

// The manifest's icons (the 512 is also the maskable one) and the iOS home
// screen, which wants exactly 180 and blurs anything it has to resize.
for (const [file, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(`${publicDir}${file}`, encodePng(size, draw(size, MARK)));
  console.log(file);
}

writeFileSync(`${publicDir}icon.svg`, vector(MARK));
console.log('icon.svg');

writeFileSync(`${publicDir}favicon.svg`, vector(FAVICON));
console.log('favicon.svg');
