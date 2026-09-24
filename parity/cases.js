// What the hosted API does, as executable expectations.
//
// Vej claims to be a drop-in for `POST /v1/systemone`, and that claim was only
// ever checked against the SDK's TypeScript types — which describe the client,
// not the server. These cases put the same bytes to both and compare what
// comes back: status, error shape, answer shape, and limits.
//
// They are deliberately about the contract, never about the numbers. Vej runs
// different weights and will not agree with Jev on a probability; it has to
// agree on everything around it.

const noul = (instructions) => ({ type: "noul", instructions });

const levels = (count) => Array.from({ length: count }, (_, i) => `Level ${i}.`);
const labels = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`l${i}`, `d${i}`]));

/**
 * `body` is sent verbatim. `expect` records what the hosted API was observed
 * to do, so a case fails loudly if Jev itself changes.
 */
export const CASES = [
  {
    name: "a noul answers",
    body: { state: "The parcel is three weeks late.", model: "jev-latest", questions: { q: noul("The delivery is late.") } },
    expect: { status: 200, answerKeys: { q: ["noul", "type"] } },
  },
  {
    name: "a choice answers",
    body: {
      state: "My parcel is three weeks late.",
      model: "jev-latest",
      questions: { q: { type: "choice", instructions: "Which team?", criteria: { billing: "Charges", shipping: "Delivery" } } },
    },
    expect: { status: 200, answerKeys: { q: ["choice", "confidence", "probabilities", "type"] } },
  },
  {
    name: "a score answers",
    body: {
      state: "The trip took about an hour.",
      model: "jev-latest",
      questions: { q: { type: "score", instructions: "How long?", criteria: levels(3) } },
    },
    expect: { status: 200, answerKeys: { q: ["confidence", "legend", "probabilities", "score", "type"] } },
  },
  {
    name: "state may be an array",
    body: { state: ["one", "two"], model: "jev-latest", questions: { q: noul("There are two items.") } },
    expect: { status: 200 },
  },
  {
    name: "state may be an empty string",
    body: { state: "", model: "jev-latest", questions: { q: noul("The sky is blue.") } },
    expect: { status: 200 },
  },
  {
    name: "criteria may be null per label",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "choice", instructions: "?", criteria: { a: null, b: null } } } },
    expect: { status: 200 },
  },
  {
    name: "one choice label is allowed",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "choice", instructions: "?", criteria: { only: "one" } } } },
    expect: { status: 200 },
  },
  {
    name: "one score level is allowed",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "score", instructions: "?", criteria: ["only"] } } },
    expect: { status: 200 },
  },
  {
    name: "state is required, and null is not a value",
    body: { state: null, model: "jev-latest", questions: { q: noul("The sky is blue.") } },
    expect: { status: 422, detail: "list" },
  },
  {
    name: "model is required",
    body: { state: "x", questions: { q: noul("The sky is blue.") } },
    expect: { status: 422, detail: "list" },
  },
  {
    name: "questions must not be empty",
    body: { state: "x", model: "jev-latest", questions: {} },
    expect: { status: 422, detail: "list" },
  },
  {
    name: "an unknown model is refused",
    body: { state: "x", model: "not-a-model", questions: { q: noul("?") } },
    expect: { status: 400, detail: "object" },
  },
  {
    name: "an unknown question type is refused",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "vibe", instructions: "?" } } },
    expect: { status: 400, detail: "object" },
  },
  {
    name: "a noul needs instructions or criteria",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "noul" } } },
    expect: { status: 400, detail: "string" },
  },
  {
    name: "at most 10 score levels",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "score", instructions: "?", criteria: levels(11) } } },
    expect: { status: 400, detail: "string" },
  },
  {
    name: "at most 255 choice labels",
    body: { state: "x", model: "jev-latest", questions: { q: { type: "choice", instructions: "?", criteria: labels(256) } } },
    expect: { status: 400, detail: "string" },
  },
  {
    name: "a bad key is rejected",
    body: { state: "x", model: "jev-latest", questions: { q: noul("?") } },
    auth: "Bearer sk-not-a-real-key",
    expect: { status: 401, detail: "object" },
  },
  {
    name: "no key at all is forbidden",
    body: { state: "x", model: "jev-latest", questions: { q: noul("?") } },
    auth: null,
    expect: { status: 403, detail: "object" },
  },
];

/** `GET /v1/models` is part of the same contract; the SDK reads it. */
export const MODELS_CASE = { name: "the model list", path: "/v1/models", expect: { status: 200, key: "models" } };
