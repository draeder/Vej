// The HTTP surface, checked against what a TypeSafe client expects to find.

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

const post = (path, body, headers = {}) =>
  fetch(`${started.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("POST /v1/systemone answers in the shape the API answers in", async () => {
  const response = await post("/v1/systemone", {
    state: "Can I talk to a real person?",
    model: "vej-latest",
    questions: { escalate: noul("Is the customer asking for a human agent?") },
  });

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-typesafe-request-id"));

  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["answers", "model", "usage"]);
  assert.equal(body.answers.escalate.type, "noul");
  assert.ok(body.answers.escalate.noul > 0.8);
  assert.equal(typeof body.usage.input_tokens, "number");
  assert.equal(typeof body.usage.output_tokens, "number");
});

test("a bad request fails as a bad request, not as a server error", async () => {
  const empty = await post("/v1/systemone", { state: "x", questions: {} });
  assert.equal(empty.status, 422);
  assert.equal((await empty.json()).error.type, "invalid_request_error");

  const broken = await post("/v1/systemone", "{not json");
  assert.equal(broken.status, 400);
});

test("the API key is required and the playground is not", async () => {
  const denied = await post("/v1/systemone", { state: "x", questions: { q: noul("?") } }, {
    authorization: "Bearer wrong",
  });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.type, "authentication_error");

  const page = await fetch(`${started.url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
});

test("GET /v1/models lists what the server can be asked for", async () => {
  const response = await fetch(`${started.url}/v1/models`, {
    headers: { authorization: "Bearer secret" },
  });
  const { data } = await response.json();

  assert.ok(data.length > 0);
  assert.deepEqual(Object.keys(data[0]).sort(), ["description", "name", "release_date"]);

});

test("POST /v1/plan prices a request without answering it", async () => {
  const response = await post("/v1/plan", {
    state: "some state",
    questions: { q: noul("Is it so?") },
  });
  const plan = await response.json();

  assert.equal(response.status, 200);
  assert.equal(plan.forwardPasses, 1, "calibration is off on this engine");
  assert.equal(plan.questions[0].type, "noul");
});

test("static serving does not escape the web root", async () => {
  const response = await fetch(`${started.url}/../package.json`);
  assert.equal(response.status, 404);
});
