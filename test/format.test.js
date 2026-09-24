// The playground's geometry.
//
// This file exists because of a real bug: the bar width was set from the same
// function that writes the label, which returns `<0.1%` for a small
// probability. That is not a CSS length, so the browser dropped the
// declaration, `width` stayed `auto`, and every unlikely option rendered as a
// full-width bar. Nothing failed; it just looked wrong, and only to someone
// reading the chart.
//
// So every value the page puts into a style is produced by a function here,
// and every one of them is checked against what CSS will actually accept.

import assert from "node:assert/strict";
import { test } from "node:test";

import { asPercent, barWidth, columnHeight, describeTiming, needleOffset, pixels } from "../web/format.js";

/** What a browser accepts as a length: a number and a unit, nothing else. */
const CSS_LENGTH = /^-?\d+(\.\d+)?(%|px|em|rem|vh|vw)$/;

const isLength = (value, note) => {
  assert.match(String(value), CSS_LENGTH, `${note}: ${JSON.stringify(value)} is not a CSS length`);
  assert.ok(!/[<>]/.test(String(value)), `${note}: ${JSON.stringify(value)} carries a comparison sign`);
};

test("a bar width is always a CSS length, at every probability", () => {
  for (const p of [0, 0.0001, 0.0006, 0.003, 0.489, 0.5, 0.9958, 0.997, 0.9999, 1]) {
    isLength(barWidth(p), `barWidth(${p})`);
  }
  assert.equal(barWidth(0), "0%");
  assert.equal(barWidth(1), "100%");
  assert.equal(barWidth(0.489), "48.9%");
});

test("a bar width is never the label, which is not CSS", () => {
  // The exact regression. These are the two labels that broke it.
  assert.equal(asPercent(0.0006), "<0.1%");
  assert.equal(asPercent(0.9999), ">99.9%");
  assert.doesNotMatch(asPercent(0.0006), CSS_LENGTH);
  assert.doesNotMatch(asPercent(0.9999), CSS_LENGTH);

  // The width for the same probabilities stays usable, and stays small.
  assert.equal(barWidth(0.0006), "0.06%");
  isLength(barWidth(0.9999), "barWidth at the top");
});

test("nonsense in gives zero out rather than a broken declaration", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null]) {
    isLength(barWidth(bad), `barWidth(${bad})`);
    isLength(columnHeight(bad, 1), `columnHeight(${bad})`);
    isLength(pixels(bad), `pixels(${bad})`);
  }
  // A probability outside the unit interval is an upstream bug, but it must
  // not become a bar wider than its track.
  assert.equal(barWidth(1.4), "100%");
  assert.equal(barWidth(-3), "0%");
});

test("a column height is relative to the tallest, and survives an empty chart", () => {
  assert.equal(columnHeight(0.5, 1), "50%");
  assert.equal(columnHeight(0.25, 0.5), "50%");
  assert.equal(columnHeight(0.5, 0), "0%", "no tallest bar means no division");
  isLength(columnHeight(0.001, 0.996), "a tiny column");
});

test("a run's time is reported as loading the model and using it, never added together", () => {
  // The first run in a tab. One number here would read as a slow model, when
  // almost all of it was fetching weights that the next run will not fetch.
  assert.deepEqual(describeTiming({ load: 1048.4, answer: 75.2, total: 1130 }), ["1048 ms load", "75 ms answer"]);
  // Every run after it. A load that did not happen is not a 0 ms load.
  assert.deepEqual(describeTiming({ load: null, answer: 75.2, total: 76 }), ["model already loaded", "75 ms answer"]);
  // On the server the weights are already up, so there is one honest number.
  assert.deepEqual(describeTiming({ total: 120.6 }), ["121 ms total"]);
  // A clock that went backwards is a bug upstream, not a negative duration.
  assert.deepEqual(describeTiming({ load: -5, answer: Number.NaN, total: 0 }), ["0 ms load", "0 ms answer"]);
});

test("the needle sits over the column its score names", () => {
  // Four levels: centres at 12.5%, 37.5%, 62.5%, 87.5%.
  assert.equal(needleOffset(0, 4), "12.5%");
  assert.equal(needleOffset(1, 4), "37.5%");
  assert.equal(needleOffset(3, 4), "87.5%");
  // Between levels, which is where a score usually lands.
  assert.equal(needleOffset(1.5, 4), "50%");
  // And never off the end of the chart.
  isLength(needleOffset(99, 4), "a score past the last level");
  assert.equal(needleOffset(99, 4), "87.5%");
});
