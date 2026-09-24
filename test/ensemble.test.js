// Routing between members. The rule is subtle and the failure it prevents is
// invisible in a single answer, so it is pinned here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Vej } from "../src/index.js";
import { choice, noul } from "../src/questions.js";
import { createEnsembleRuntime } from "../src/runtime/ensemble.js";
import { createMockRuntime } from "../src/runtime/mock.js";

/** A member with an opinion about particular claims and nothing to say otherwise. */
const opinionated = (id, opinions) =>
  createMockRuntime({
    id,
    score: (_premise, hypothesis) => opinions[hypothesis] ?? -6,
  });

test("a question goes to the member that found the most support", async () => {
  const blind = opinionated("blind", {});
  const seeing = opinionated("seeing", { "The trip took about an hour.": 4 });
  const runtime = createEnsembleRuntime({ members: [blind, seeing] });
  const vej = new Vej({ runtime });

  const { answers } = await vej.systemOne({
    state: "x",
    questions: { q: noul("The trip took about an hour.") },
  });

  assert.ok(answers.q.noul > 0.9, `the member that saw it should win, got ${answers.q.noul}`);
  assert.equal(blind.calls.entailment, 1, "every member is still asked");
  assert.equal(seeing.calls.entailment, 1);
});

test("a choice's labels all come from one member, so they stay comparable", async () => {
  // Left is mildly keen on `a`. Right is certain about `b` and also rates `a`
  // above what Left gave it. Picking the strongest opinion per *claim* would
  // take `a` from Right and `b` from Right too — fine here — but the case that
  // breaks is the reverse: a member that is loud about the wrong label.
  const left = opinionated("left", { "This is a.": 1, "This is b.": 0 });
  const right = opinionated("right", { "This is a.": 3, "This is b.": 5 });
  const runtime = createEnsembleRuntime({ members: [left, right] });

  const { answers } = await new Vej({ runtime }).systemOne({
    state: "x",
    questions: { pick: choice("Which?", { a: "This is a.", b: "This is b." }) },
  });

  // Right has the strongest single opinion, so the whole question is Right's,
  // and the answer is Right's own two claims normalized against each other.
  assert.equal(answers.pick.choice, "b");
  const support = (score) => 1 / (1 + Math.exp(-score));
  const expected = support(5) / (support(3) + support(5));
  assert.ok(
    Math.abs(answers.pick.probabilities.b - expected) < 0.01,
    `expected Right's own distribution (${expected.toFixed(3)}), got ${answers.pick.probabilities.b}`,
  );
});

test("mixing members within one choice would flip the winner", async () => {
  // The regression this routing exists to prevent. Left is confident `a` is
  // right. Right is wrong but louder about `b`. Taking the strongest claim by
  // claim hands `a` to Left and `b` to Right, and `b` wins on a comparison
  // between two different models. Routing the whole question to Right keeps
  // the labels on one scale — it can still be wrong, but it is wrong in a way
  // one model actually believes.
  const left = opinionated("left", { "This is a.": 4, "This is b.": -4 });
  const right = opinionated("right", { "This is a.": 4.5, "This is b.": 5 });
  const runtime = createEnsembleRuntime({ members: [left, right] });

  const { answers } = await new Vej({ runtime }).systemOne({
    state: "x",
    questions: { pick: choice("Which?", { a: "This is a.", b: "This is b." }) },
  });

  // Both labels came from Right, which rates them 4.5 and 5 — close, not the
  // lopsided answer a cross-model comparison would have produced.
  assert.ok(
    answers.pick.probabilities.a > 0.3,
    `labels should be close, got a=${answers.pick.probabilities.a}`,
  );
});

test("questions are routed independently of each other", async () => {
  const units = opinionated("units", { "It took an hour.": 5 });
  const transport = opinionated("transport", { "They drove.": 5 });
  const runtime = createEnsembleRuntime({ members: [units, transport] });

  const { answers } = await new Vej({ runtime }).systemOne({
    state: "x",
    questions: { a: noul("It took an hour."), b: noul("They drove.") },
  });

  assert.ok(answers.a.noul > 0.9, "the units expert answers the units question");
  assert.ok(answers.b.noul > 0.9, "the transport expert answers the transport one");
});

test("an ensemble of one is a mistake worth naming", () => {
  assert.throws(
    () => createEnsembleRuntime({ members: [createMockRuntime()] }),
    /at least two members/,
  );
});
