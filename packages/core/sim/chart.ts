/**
 * Line charts, written as SVG by hand.
 *
 * A charting library would be four hundred kilobytes to draw six lines, and it
 * would have to be a dependency of a package that is meant to have none. String
 * templating is enough: axes, ticks, a legend and a polyline.
 *
 * The palette is the light theme from packages/config/tokens.css. These files
 * end up in the documentation on a page that may be read on either theme, so
 * they carry their own light surface rather than sitting transparent.
 */

/** One line on a chart. */
export interface Series {
  readonly label: string;
  readonly colour: string;
  readonly values: readonly number[];
  /** Drawn as a dashed line, for a reference such as the budget. */
  readonly dashed?: boolean;
}

/** Everything a chart needs. */
export interface ChartOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly series: readonly Series[];
  /** Forces the top of the scale, for two charts that must be comparable. */
  readonly yMax?: number;
  /** What the first point is called on the axis, when it is not day zero. */
  readonly xStart?: number;
  /**
   * A label for every point, when the axis is not a run of days. Used by the
   * sensitivity chart, whose points are values of a parameter rather than
   * dates, and where an axis reading 0 to 7 would be a lie.
   */
  readonly xLabels?: readonly string[];
}

const WIDTH = 760;
const HEIGHT = 380;
const PAD_LEFT = 60;
const PAD_RIGHT = 18;
const PAD_TOP = 84;
const PAD_BOTTOM = 46;

const SURFACE = '#ffffff';
const BORDER = '#e4e4e8';
const TEXT = '#17171a';
const TEXT_DIM = '#6e6e76';

/** The colours the runs are drawn in. */
export const CHART_COLOURS = {
  accent: '#3565ce',
  danger: '#c25450',
  warn: '#c08a2e',
  success: '#3f9e6b',
  dim: TEXT_DIM,
} as const;

/** Turns the five characters that matter into entities. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A number with at most one decimal, and no trailing zero. */
function shortNumber(value: number): string {
  if (value >= 100) {
    return String(Math.round(value));
  }

  return String(Math.round(value * 10) / 10);
}

/** Picks a round number at or above the highest value plotted. */
function niceCeiling(highest: number): number {
  if (highest <= 0) {
    return 1;
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));

  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (highest <= step * magnitude) {
      return step * magnitude;
    }
  }

  return 10 * magnitude;
}

/**
 * Smooths a daily series with a centred moving average.
 *
 * Daily study minutes are jagged: a skipped day is a zero and the day after it
 * is a spike. The shape of the trend is what the chart is for, so it is drawn
 * over the noise rather than under it.
 *
 * @param values the daily numbers
 * @param window how many days to average over
 * @returns a series of the same length
 */
export function movingAverage(values: readonly number[], window = 7): number[] {
  const reach = Math.floor(window / 2);

  return values.map((_unused, index) => {
    const from = Math.max(0, index - reach);
    const to = Math.min(values.length - 1, index + reach);
    let total = 0;

    for (let at = from; at <= to; at += 1) {
      total += values[at] ?? 0;
    }

    return total / (to - from + 1);
  });
}

/**
 * Draws a line chart.
 *
 * @param options the title, the axes and the lines
 * @returns a complete SVG document
 */
export function lineChart(options: ChartOptions): string {
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const length = Math.max(...options.series.map((line) => line.values.length), 1);
  const highest = Math.max(
    ...options.series.flatMap((line) => line.values.filter((value) => Number.isFinite(value))),
    0,
  );
  const top = options.yMax ?? niceCeiling(highest);

  const xFor = (index: number): number =>
    PAD_LEFT + (length <= 1 ? 0 : (index / (length - 1)) * plotWidth);
  const yFor = (value: number): number =>
    PAD_TOP + plotHeight - (Math.min(value, top) / top) * plotHeight;

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">`,
  );
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${SURFACE}"/>`);
  parts.push(
    `<text x="${PAD_LEFT}" y="28" font-size="15" fill="${TEXT}">${escape(options.title)}</text>`,
  );
  parts.push(
    `<text x="${PAD_LEFT}" y="48" font-size="11" fill="${TEXT_DIM}">${escape(options.subtitle)}</text>`,
  );

  // The legend gets a row of its own under the subtitle. Tucking it into a
  // corner of the plot works until a title is long enough to reach it.
  let legendX = PAD_LEFT;

  for (const line of options.series) {
    parts.push(
      `<line x1="${legendX.toFixed(1)}" y1="68" x2="${(legendX + 14).toFixed(1)}" y2="68" stroke="${line.colour}" stroke-width="2"${line.dashed === true ? ' stroke-dasharray="5 4"' : ''}/>`,
    );
    parts.push(
      `<text x="${(legendX + 20).toFixed(1)}" y="72" font-size="11" fill="${TEXT_DIM}">${escape(line.label)}</text>`,
    );
    legendX += 34 + line.label.length * 6.2;
  }

  // Horizontal grid lines, five of them, labelled on the left.
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (top / 4) * tick;
    const y = yFor(value);

    parts.push(
      `<line x1="${PAD_LEFT}" y1="${y.toFixed(1)}" x2="${(WIDTH - PAD_RIGHT).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${BORDER}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${PAD_LEFT - 8}" y="${(y + 4).toFixed(1)}" font-size="11" fill="${TEXT_DIM}" text-anchor="end">${shortNumber(value)}</text>`,
    );
  }

  // Vertical ticks every thirty days, or every tenth of the run if it is short.
  const xStep =
    options.xLabels === undefined ? (length > 120 ? 60 : Math.max(1, Math.round(length / 6))) : 1;

  for (let index = 0; index < length; index += xStep) {
    const x = xFor(index);
    const label = options.xLabels?.[index] ?? String(index + (options.xStart ?? 0));

    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${PAD_TOP + plotHeight}" x2="${x.toFixed(1)}" y2="${PAD_TOP + plotHeight + 5}" stroke="${BORDER}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x.toFixed(1)}" y="${PAD_TOP + plotHeight + 19}" font-size="11" fill="${TEXT_DIM}" text-anchor="middle">${escape(label)}</text>`,
    );
  }

  parts.push(
    `<text x="${PAD_LEFT + plotWidth / 2}" y="${HEIGHT - 8}" font-size="11" fill="${TEXT_DIM}" text-anchor="middle">${escape(options.xLabel)}</text>`,
  );
  parts.push(
    `<text x="14" y="${PAD_TOP + plotHeight / 2}" font-size="11" fill="${TEXT_DIM}" text-anchor="middle" transform="rotate(-90 14 ${PAD_TOP + plotHeight / 2})">${escape(options.yLabel)}</text>`,
  );

  for (const line of options.series) {
    const points = line.values
      .map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`)
      .join(' ');

    parts.push(
      `<polyline points="${points}" fill="none" stroke="${line.colour}" stroke-width="${line.dashed === true ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"${line.dashed === true ? ' stroke-dasharray="5 4"' : ''}/>`,
    );
  }

  parts.push('</svg>');

  return `${parts.join('\n')}\n`;
}
