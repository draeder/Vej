// The cross-encoder path: the same questions, asked as claims.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Vej } from "../src/index.js";
import { toHypotheses, toPremise } from "../src/hypotheses.js";
import { choice, noul, score } from "../src/questions.js";
import { createMockRuntime } from "../src/runtime/mock.js";

/** An entailment runtime whose opinion depends only on the claim. */
const claimOnly = (weights) =>
  createMockRuntime({
    kind: "entailment",
    score: (_premise, hypothesis) => weights[hypothesis] ?? 0,
  });

const sum = (values) => values.reduce((a, b) => a + b, 0);

test("a noul asks one claim, not two", async () => {
  const runtime = claimOnly({ "The customer wants a person.": 3 });
  const vej = new Vej({ runtime });
  const { answers } = await vej.systemOne({
    state: "Can I please just talk to a real person?",
    questions: { escalate: noul("The customer wants a person.") },
  });

  // 3 through a sigmoid is ~0.953; `false` is the remainder, not a rival claim.
  // Two decimals now, matching the hosted API, so compare at that resolution.
  assert.equal(answers.escalate.noul, Math.round((1 / (1 + Math.exp(-3))) * 100) / 100);
  assert.equal(runtime.calls.entailment, 1, "one claim, one pass");
});

test("an unrelated state reads as no, not as a coin flip", async () => {
  // The point of scoring entailment against the model's whole label set: a
  // premise with nothing to say puts its mass elsewhere and the noul is low.
  const vej = new Vej({ runtime: claimOnly({ "The customer wants a person.": -4 }) });
  const { answers } = await vej.systemOne({
    state: "Thanks, that fixed it!",
    questions: { escalate: noul("The customer wants a person.") },
  });
  assert.ok(answers.escalate.noul <= 0.02, `expected a clear no, got ${answers.escalate.noul}`);
});

test("a choice scores one claim per label and needs no rotation", async () => {
  const runtime = claimOnly({
    "This is delivery status, delays or a lost package.": 5,
    "This is charges, invoices or refunds.": 0,
  });
  const vej = new Vej({ runtime, permutations: 3 });
  const { answers } = await vej.systemOne({
    state: "My parcel is three weeks late.",
    questions: {
      team: choice("Which team?", {
        billing: "Charges, invoices or refunds",
        shipping: "Delivery status, delays or a lost package",
      }),
    },
  });

  assert.equal(answers.team.choice, "shipping");
  assert.equal(sum(Object.values(answers.team.probabilities)), 1);
  assert.equal(
    runtime.calls.entailment,
    1,
    "permutations are ignored: labels are never shown as a list, so there is no order to cancel",
  );
});

test("a score keeps its rubric and its number line", async () => {
  // Claims are scored independently, so "not the other levels" has to be said
  // explicitly: leaving them at zero leaves them at even odds, and the
  // expected score lands mid-scale rather than at the top.
  const vej = new Vej({
    runtime: claimOnly({
      "This is neutral or friendly.": -4,
      "This is mildly impatient.": -2,
      "This is clearly annoyed.": 4,
    }),
  });
  const { answers } = await vej.systemOne({
    state: "I have asked three times now.",
    questions: {
      frustration: score("How frustrated?", ["Neutral or friendly", "Mildly impatient", "Clearly annoyed"]),
    },
  });

  assert.equal(answers.frustration.legend[2], "Clearly annoyed");
  assert.ok(answers.frustration.score > 1.8, `expected the top level to dominate, got ${answers.frustration.score}`);
  assert.equal(sum(Object.values(answers.frustration.probabilities)), 1);
});

test("calibration is skipped: there is no marker prior to divide out", async () => {
  const runtime = claimOnly({ "It is so.": 1 });
  await new Vej({ runtime, calibrate: true }).systemOne({
    state: "x",
    questions: { q: noul("It is so.") },
  });
  assert.equal(runtime.calls.entailment, 1, "one pass, not two");
});

test("every question in a request shares one forward pass", async () => {
  const runtime = claimOnly({});
  const vej = new Vej({ runtime });
  const { answers } = await vej.systemOne({
    state: "some state",
    questions: {
      a: noul("It is so."),
      b: choice("Which?", { one: "The first", two: "The second" }),
      c: score("How much?", ["None", "Some", "Lots"]),
    },
  });

  assert.equal(Object.keys(answers).length, 3);
  assert.equal(runtime.calls.entailment, 1);
});

test("criteria become claims, and a fragment is made into a sentence", () => {
  assert.deepEqual(toHypotheses(noul("The customer is angry.")), ["The customer is angry."]);

  // The instruction is the claim; `criteria.true` only says where the boundary
  // falls. Preferring the criterion turns the hypothesis into a subjectless
  // fragment about nobody, which scored 0.2% on a state that plainly matched.
  assert.deepEqual(
    toHypotheses(
      noul("The customer is asking for a human agent.", {
        true: "They ask for a person, or to stop talking to a bot",
        false: "They are asking something an assistant could answer",
      }),
    ),
    ["The customer is asking for a human agent."],
  );

  assert.deepEqual(
    toHypotheses(choice("Which team?", { billing: "Charges and refunds", shipping: "Lost parcels." })),
    ["This is charges and refunds.", "Lost parcels."],
  );

  // Nothing to work with: the label still has to become a claim.
  assert.deepEqual(toHypotheses(choice("Which?", { spam: null, ham: null })), [
    "This is about spam.",
    "This is about ham.",
  ]);
});

test("state becomes prose, because a field dump is not a sentence", () => {
  assert.equal(toPremise("just text"), "just text");

  // Text leaves keep their own words and lose their keys. Rendering these as
  // `message: "..."` lines measurably costs entailment — on one state a claim
  // the text made outright fell from 0.96 to 0.06.
  assert.equal(
    toPremise({ message: "The trip took an hour.", channel: "chat" }),
    "The trip took an hour.\nchat",
  );

  // A bare number says nothing on its own, so it keeps its key.
  assert.equal(toPremise({ note: "Delayed.", minutes: 40 }), "Delayed.\nminutes: 40");

  // Nesting and arrays flatten into the same prose.
  assert.equal(
    toPremise({ ticket: { messages: ["First.", "Second."] } }),
    "First.\nSecond.",
  );
});

test("plan prices claims instead of prompts", async () => {
  const runtime = claimOnly({});
  const plan = await new Vej({ runtime }).plan({
    state: "some state",
    questions: { team: choice("Which?", { one: "The first", two: "The second" }) },
  });

  assert.equal(plan.pairs, 2);
  assert.equal(plan.forwardPasses, 1);
  assert.deepEqual(plan.questions[0].hypotheses, ["This is the first.", "This is the second."]);
  assert.equal(runtime.calls.entailment, 0, "planning runs nothing");
});
