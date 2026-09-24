// The HTTP surface, against what the hosted API was observed to do.
//
// Shapes and status codes here are not opinions: `parity/run.js` puts the same
// requests to both and these mirror what came back. Errors live under
// `detail`, never under `error`.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Vej } from "../src/index.js";
import { noul } from "../src/questions.js";
import { createMockRuntime } from "../src/runtime/mock.js";
import { serve } from "../src/server.js";

const engine = new Vej({
  runtime: createMockRuntime({ score: (_premise, claim) => (claim.includes("human") ? 2 : 0) }),
});

const started = await serve({ port: 0, engine, apiKey: "secret" });
after(() => {
  // `fetch` keeps its sockets alive, so closing the listener is not enough to
  // let the test process exit.
  started.server.closeAllConnections();
  started.server.close();
});

const ask = (body, headers = {}) =>
  fetch(`${started.url}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = (questions) => ({ state: "Can I talk to a real person?", model: "vej-latest", questions });

test("POST /v1/systemone answers in the shape the API answers in", async () => {
  const response = await ask(valid({ escalate: noul("Is the customer asking for a human agent?") }));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-typesafe-request-id"), /^req_[0-9a-f]{32}$/);

  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["answers", "model", "usage"]);
  assert.deepEqual(Object.keys(body.answers.escalate).sort(), ["noul", "type"]);
  assert.deepEqual(Object.keys(body.usage).sort(), ["input_tokens", "output_tokens"]);
});

test("probabilities carry two decimals, as the hosted API sends them", async () => {
  const body = await (await ask(valid({ q: noul("Is the customer asking for a human agent?") }))).json();
  const places = String(body.answers.q.noul).split(".")[1]?.length ?? 0;
  assert.ok(places <= 2, `expected at most two decimals, got ${body.answers.q.noul}`);
});

test("a refusal is a `detail`, and its shape follows the status", async () => {
  const missing = await ask({ model: "vej-latest", questions: { q: noul("?") } });
  assert.equal(missing.status, 422);
  const missingBody = await missing.json();
  assert.ok(Array.isArray(missingBody.detail), "422 sends a list of field problems");
  assert.deepEqual(missingBody.detail[0].loc, ["body", "state"]);
  assert.equal("error" in missingBody, false, "never an `error` key");

  const unknown = await ask({ ...valid({ q: noul("?") }), model: "not-a-model" });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).detail.error_type, "api_usage_error");

  const tooMany = await ask(
    valid({ q: { type: "score", instructions: "?", criteria: Array(11).fill("level") } }),
  );
  assert.equal(tooMany.status, 400);
  assert.equal((await tooMany.json()).detail, "Too many score levels. Must have at most 10 levels.");

  const broken = await ask("{not json");
  assert.equal(broken.status, 400);
});

test("no key is forbidden, a wrong key is unauthorized", async () => {
  const none = await fetch(`${started.url}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(valid({ q: noul("?") })),
  });
  assert.equal(none.status, 403, "the hosted API separates these two");
  assert.equal((await none.json()).detail.error_type, "authentication_error");

  const wrong = await ask(valid({ q: noul("?") }), { authorization: "Bearer wrong" });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).detail.error_type, "authentication_error");

  const page = await fetch(`${started.url}/`);
  assert.equal(page.status, 200, "the playground needs no key");
});

test("GET /v1/models is keyed by `models`, as the SDK reads it", async () => {
  const response = await fetch(`${started.url}/v1/models`, { headers: { authorization: "Bearer secret" } });
  const body = await response.json();

  assert.ok(Array.isArray(body.models), "not `data`, which is what this used to send");
  assert.ok(body.models.length > 0);
  assert.deepEqual(Object.keys(body.models[0]).sort(), ["description", "name", "release_date"]);
});

test("POST /v1/plan prices a request without answering it", async () => {
  const response = await fetch(`${started.url}/v1/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify(valid({ q: noul("Is it so?") })),
  });
  const plan = await response.json();

  assert.equal(response.status, 200);
  assert.equal(plan.questions[0].type, "noul");
  assert.equal(plan.pairs, 1);
});

test("static serving does not escape the web root", async () => {
  const response = await fetch(`${started.url}/../package.json`);
  assert.equal(response.status, 404);
});
