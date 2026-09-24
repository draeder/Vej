// Probability in words: the scale, and the answers that carry it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Vej } from "../src/index.js";
import { noul, score } from "../src/questions.js";
import { createMockRuntime } from "../src/runtime/mock.js";
import { asPercent, phraseFor, probabilityFor, SCALE } from "../src/words.js";

test("a threshold can be written in language", () => {
  assert.equal(probabilityFor("likely"), 0.75);
  assert.equal(probabilityFor("Probable"), 0.7);
  assert.equal(probabilityFor("  UNLIKELY "), 0.15);
  assert.throws(() => probabilityFor("pretty sure"), /No published median/);
});

test("a probability gets the nearest phrase, and no more than that", () => {
  assert.equal(phraseFor(0.9), "almost certainly");
  assert.equal(phraseFor(0.5), "about even");
  assert.equal(phraseFor(0.15), "unlikely");
  assert.equal(phraseFor(0.72), "probable");

  // Past the ends of the scale, the end phrases hold. A saturated 1.00 is
  // reported as "almost certainly" because the survey publishes no anchor
  // above 90%, and a model's 1.00 does not earn one.
  assert.equal(phraseFor(1), "almost certainly");
  assert.equal(phraseFor(0), "unlikely");
});

test("the scale is ordered and only holds published medians", () => {
  const values = SCALE.map((entry) => entry.probability);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  for (const { phrase, probability } of SCALE) {
    assert.ok(probability > 0 && probability < 1, `${phrase} should not claim certainty`);
  }
});

test("phrases are additive and off by default", async () => {
  const runtime = createMockRuntime({ score: (_premise, claim) => (claim.includes("so") ? 2 : 0) });
  const request = { state: "x", questions: { q: noul("Is it so?") } };

  const plain = await new Vej({ runtime }).systemOne(request);
  assert.deepEqual(Object.keys(plain.answers.q).sort(), ["noul", "type"]);

  const spoken = await new Vej({ runtime, words: true }).systemOne(request);
  assert.deepEqual(Object.keys(spoken.answers.q).sort(), ["noul", "phrase", "type"]);
  assert.equal(spoken.answers.q.noul, plain.answers.q.noul, "the number does not move");
  assert.equal(spoken.answers.q.phrase, phraseFor(plain.answers.q.noul));
});

test("a score gets no phrase, because it is a position and not a probability", async () => {
  const runtime = createMockRuntime({ score: (_premise, claim) => (claim === "Lots." ? 3 : -3) });
  const { answers } = await new Vej({ runtime, words: true }).systemOne({
    state: "x",
    questions: { level: score("How much?", ["None", "Some", "Lots"]) },
  });

  assert.equal(answers.level.phrase, undefined);
  assert.deepEqual(Object.keys(answers.level).sort(), [
    "confidence",
    "legend",
    "probabilities",
    "score",
    "type",
  ]);
});

test("a percentage never rounds up into certainty", () => {
  // The bug this exists to stop: 0.997 printed as "100%" next to a "0.3%" that
  // it does not sum with, and beside the phrase "almost certainly".
  assert.equal(asPercent(0.997), "99.7%", "this is the one that used to print 100%");
  assert.equal(asPercent(1), ">99.9%", "even an exact 1 does not get the word");
  assert.equal(asPercent(0.9999), ">99.9%");
  assert.equal(asPercent(0), "<0.1%");
  assert.equal(asPercent(0.0003), "<0.1%");
  assert.equal(asPercent(0.489), "48.9%");
  assert.equal(asPercent(0.5), "50.0%");
});
