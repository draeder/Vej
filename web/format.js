// The numbers the page turns into geometry and text.
//
// These are here, apart from the rendering, because they are the part that can
// be wrong silently. A label that reads badly is visible; a CSS value that is
// not a length is not — the browser drops the declaration and the element
// keeps whatever it had, which is how every unlikely option came to draw a
// full-width bar for an hour without anyone noticing.
//
// So: text formatting and geometry are different functions with different
// return types, and `test/format.test.js` checks that the geometry ones can
// only produce valid CSS.

import { asPercent } from "../src/words.js";

export { asPercent };

/** Clamp to the unit interval; a probability outside it is a bug upstream. */
const unit = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * The width of a bar showing `probability`, as a CSS length.
 *
 * Never `asPercent`, which is for reading: it returns things like `<0.1%` and
 * `>99.9%`, which are not CSS and leave `width` unset.
 */
export const barWidth = (probability) => `${unit(probability) * 100}%`;

/** The height of a column, relative to the tallest in its chart. */
export const columnHeight = (probability, tallest) =>
  `${tallest > 0 ? (unit(probability) / tallest) * 100 : 0}%`;

/**
 * Where a score falls across the columns, as a CSS offset.
 *
 * The scale runs 0 to `levels - 1` across the centres of the first and last
 * columns, so level n sits at (n + 0.5) / levels of the width.
 */
export const needleOffset = (score, levels) => {
  const safe = Number.isFinite(score) ? Math.min(levels - 1, Math.max(0, score)) : 0;
  return `${((0.5 + safe) / levels) * 100}%`;
};

/** A pixel height, for the gutter lines that mirror wrapped text. */
export const pixels = (value) => `${Number.isFinite(value) ? Math.max(0, value) : 0}px`;
