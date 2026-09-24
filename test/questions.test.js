// Validation and the probability arithmetic: the parts that decide what
// reaches the model, and what is made of what comes back.

import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidRequestError } from "../src/errors.js";
import { choice, noul, score, validateRequest } from "../src/questions.js";
import { confidenceOf, normalize } from "../src/decode.js";

const rejects = (request, fragment) => {
  assert.throws(() => validateRequest(request), (error) => {
    assert.ok(error instanceof InvalidRequestError, `expected InvalidRequestError, got ${error}`);
    assert.match(error.message, fragment);
    return true;
  });
};

test("a request is refused before it costs anything", () => {
  rejects({ questions: { q: noul("?") } }, /must include `state`/);
  rejects({ state: "x", questions: {} }, /must not be empty/);
  rejects({ state: "x", questions: { q: { type: "vibe" } } }, /must be "noul", "choice" or "score"/);
  rejects({ state: "x", questions: { q: choice("?", { only: "one" }) } }, /at least two labels/);
  rejects({ state: "x", questions: { q: score("?", ["just one"]) } }, /at least 2 level descriptions/);
  rejects(
    { state: "x", questions: { q: score("?", Array(11).fill("level")) } },
    /the limit is 10/,
  );
  rejects(
    {
      state: "x",
      questions: {
        q: choice("?", Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`l${i}`, ""]))),
      },
    },
    /the limit is 255/,
  );
});

test("null state is state", () => {
  assert.doesNotThrow(() => validateRequest({ state: null, questions: { q: noul("?") } }));
});

test("a score takes between 2 and 10 levels, and counts what it is given", () => {
  for (const levels of [2, 5, 10]) {
    const criteria = Array.from({ length: levels }, (_, i) => `Level ${i}.`);
    assert.doesNotThrow(() =>
      validateRequest({ state: "x", questions: { s: score("?", criteria) } }),
      `${levels} levels should be accepted`,
    );
  }
});

test("confidence is concentration, from evenly spread to decided", () => {
  assert.equal(confidenceOf([0.5, 0.5]), 0);
  assert.equal(confidenceOf([1, 0]), 1);
  assert.ok(confidenceOf([0.7, 0.3]) > 0.1);
  assert.ok(confidenceOf([0.7, 0.3]) < 0.9);
  assert.ok(Math.abs(confidenceOf([1 / 3, 1 / 3, 1 / 3])) < 1e-12);
});

test("normalize divides the prior out and honours temperature", () => {
  const logprobs = [Math.log(0.9), Math.log(0.1)];

  assert.deepEqual(normalize(logprobs).map((p) => Math.round(p * 100)), [90, 10]);
  assert.deepEqual(normalize(logprobs, { prior: logprobs }), [0.5, 0.5]);

  const softened = normalize(logprobs, { temperature: 4 });
  assert.ok(softened[0] < 0.9 && softened[0] > 0.5, "a higher temperature moves toward the middle");
});
