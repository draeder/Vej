// The deadline.
//
// Callers pass `signal` as a time budget, not as a nicety: SlopGateway's hooks
// are separate short-lived processes with about four seconds each, and a hook
// that waits past its budget stops being a gate. `VejClient` is meant to drop
// into code written against the hosted SDK, so a signal it accepted there has
// to keep working here — silently ignoring one would turn a bounded wait into
// an unbounded one, which is exactly the failure the signal was added to stop.
//
// What is bounded is the *waiting*. A forward pass is one call into ONNX
// Runtime and cannot be halted halfway, so these tests check that the caller
// is released, not that the work stops.

import assert from "node:assert/strict";
import { test } from "node:test";

import { VejClient } from "../src/client.js";
import { createMockRuntime } from "../src/runtime/mock.js";
import { noul } from "../src/questions.js";

const request = { state: "The trip took about an hour.", questions: { car: noul("The writer travelled.") } };

/** A runtime whose load and inference can be held open for as long as a test needs. */
function slowRuntime({ loadMs = 0, answerMs = 0 } = {}) {
  const base = createMockRuntime();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    ...base,
    async load() {
      await wait(loadMs);
    },
    async entailment(pairs) {
      await wait(answerMs);
      return base.entailment(pairs);
    },
  };
}

test("a signal already spent means no work is started", async () => {
  const runtime = slowRuntime();
  let loads = 0;
  const client = new VejClient({ runtime: { ...runtime, load: async () => void loads++ } });
  await assert.rejects(
    () => client.systemOne(request, { signal: AbortSignal.abort() }),
    (error) => error.name === "AbortError",
  );
  assert.equal(loads, 0, "a caller out of time before it asked should not load the weights");
});

test("a deadline that passes while the weights load releases the caller", async () => {
  const client = new VejClient({ runtime: slowRuntime({ loadMs: 200 }) });
  const started = Date.now();
  await assert.rejects(
    () => client.systemOne(request, { signal: AbortSignal.timeout(20) }),
    (error) => error.name === "TimeoutError",
  );
  assert.ok(Date.now() - started < 150, "the wait ended at the deadline, not when the load finished");
});

test("a deadline that passes during judging releases the caller", async () => {
  const client = new VejClient({ runtime: slowRuntime({ answerMs: 200 }) });
  const started = Date.now();
  await assert.rejects(
    () => client.systemOne(request, { signal: AbortSignal.timeout(20) }),
    (error) => error.name === "TimeoutError",
  );
  assert.ok(Date.now() - started < 150, "the wait ended at the deadline, not when the pass finished");
});

test("a signal that never fires changes nothing, and no signal at all still works", async () => {
  const client = new VejClient({ runtime: createMockRuntime() });
  const controller = new AbortController();
  const withSignal = await client.systemOne(request, { signal: controller.signal });
  const without = await client.systemOne(request);
  assert.equal(typeof withSignal.answers.car.noul, "number");
  assert.deepEqual(withSignal.answers, without.answers);
});

test("an aborted run leaves the client usable", async () => {
  const client = new VejClient({ runtime: slowRuntime({ answerMs: 120 }) });
  await assert.rejects(() => client.systemOne(request, { signal: AbortSignal.timeout(10) }));
  // The weights are loaded now, and the next caller is not punished for the
  // last one giving up.
  const result = await client.systemOne(request);
  assert.equal(typeof result.answers.car.noul, "number");
});
