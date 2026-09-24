// Validation and the probability arithmetic: the parts that decide what
// reaches the model, and what is made of what comes back.

import assert from "node:assert/strict";
import { test } from "node:test";


import { choice, noul, score, validateApiRequest, validateRequest } from "../src/questions.js";
import { confidenceOf, normalize } from "../src/decode.js";

/** Every rule below was read off the hosted API; `parity/` keeps them honest. */
const refuses = (request, status, detail) => {
  assert.throws(() => validateRequest(request), (error) => {
    assert.equal(error.status, status, `expected ${status} for ${JSON.stringify(request).slice(0, 60)}`);
    if (typeof detail === "string") assert.equal(error.detail, detail);
    else if (detail) assert.match(JSON.stringify(error.detail), detail);
    return true;
  });
};

test("the questions a request may not ask", () => {
  refuses({ state: "x", questions: {} }, 422, /at least 1 item/);
  // A category of mistake gets an object; a limit gets a bare sentence. Jev
  // uses both shapes, so Vej does too.
  refuses({ state: "x", questions: { q: { type: "vibe" } } }, 400, /"error_type":"api_usage_error"/);
  refuses({ state: "x", questions: { q: { type: "noul" } } }, 400, "Noul question must have criteria or instructions: q");
  refuses(
    { state: "x", questions: { q: score("?", Array(11).fill("level")) } },
    400,
    "Too many score levels. Must have at most 10 levels.",
  );
  refuses(
    {
      state: "x",
      questions: { q: choice("?", Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`l${i}`, ""]))) },
    },
    400,
    "Too many choices. Must have at most 255 choices.",
  );
});

test("one label and one level are allowed, because the hosted API allows them", () => {
  // The SDK's own types say two of each, and the server takes one. Vej is the
  // server, so it takes one too — this surprised me, so it is pinned here.
  assert.doesNotThrow(() => validateRequest({ state: "x", questions: { q: choice("?", { only: "one" }) } }));
  assert.doesNotThrow(() => validateRequest({ state: "x", questions: { q: score("?", ["only"]) } }));
});

test("a score counts whatever levels it is given, up to ten", () => {
  for (const levels of [1, 2, 5, 10]) {
    const criteria = Array.from({ length: levels }, (_, i) => `Level ${i}.`);
    assert.doesNotThrow(
      () => validateRequest({ state: "x", questions: { s: score("?", criteria) } }),
      `${levels} levels should be accepted`,
    );
  }
});

test("the HTTP contract asks for more than the engine does", () => {
  const known = (name) => name === "vej-latest";
  const body = { state: "x", model: "vej-latest", questions: { q: noul("?") } };

  assert.doesNotThrow(() => validateApiRequest(body, known));
  // `state` is required and null is not a value for it — the hosted API calls
  // null a missing field, which took a live request to discover.
  refusesApi({ ...body, state: null }, known, 422, /"loc":\["body","state"\]/);
  refusesApi({ model: "vej-latest", questions: body.questions }, known, 422, /"loc":\["body","state"\]/);
  refusesApi({ state: "x", questions: body.questions }, known, 422, /"loc":\["body","model"\]/);
  refusesApi({ ...body, model: "not-a-model" }, known, 400, /Unknown model: not-a-model/);

  // The engine itself never asks for a model: the client fills it in.
  assert.doesNotThrow(() => validateRequest({ state: "x", questions: body.questions }));
});

function refusesApi(body, known, status, detail) {
  assert.throws(() => validateApiRequest(body, known), (error) => {
    assert.equal(error.status, status);
    assert.match(JSON.stringify(error.detail), detail);
    return true;
  });
}

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
