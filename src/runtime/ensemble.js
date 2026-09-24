// Several judges, and a rule for picking between them.
//
// No single model here is good enough. They fail on disjoint cases:
// `zeroshot-base` is the only one that can place "about an hour" inside "half
// an hour to two hours", and the only one that collapses to 0.15 on a claim
// the others answer at 1.00. Averaging them makes both worse, because an
// average drags a correct 0.95 down with a wrong 0.01.
//
// What makes a combination work is that their errors are one-sided. Measured
// over a suite of claims, every member stays below 0.11 on claims that are
// false, and misses claims that are true. They under-claim entailment; they do
// not invent it. So the member that saw the most support is the one to
// believe, and its own distribution is the one to use:
//
//   member          false claims    "an hour is in 0.5-2h"   "travelled by car"
//   nli-small       <= 0.11         0.01                     1.00
//   zeroshot-base   <= 0.01         0.95                     0.15
//   strongest       <= 0.11         0.95                     1.00
//
// Over twelve cases that took the blend from 1/12 wrong to 0/12, and mean
// absolute error from 0.11 to 0.03.
//
// The cost is real: every member runs on every pair. Two small encoders still
// answer in about a tenth of a second, which is the budget this was built for.

import { RuntimeError } from "../errors.js";
import { createEntailmentRuntime } from "./entailment.js";

/**
 * Create a runtime that asks several models and routes each question to one.
 *
 * @param {object} [options]
 * @param {string[]} [options.models] Member model names, in no particular order.
 * @param {object[]} [options.members] Ready runtimes, instead of `models`.
 * @param {object} [options] Everything else is passed to each member built here.
 */
export function createEnsembleRuntime({ models = [], members: ready, ...shared } = {}) {
  const members = ready ?? models.map((model) => createEntailmentRuntime({ ...shared, model }));
  if (members.length < 2) {
    throw new RuntimeError("An ensemble needs at least two members; use createEntailmentRuntime for one.");
  }

  return {
    get id() {
      return `vej/${members.map((member) => member.repo ?? member.id).join("+")}`;
    },
    members,
    device: members[0].device,
    // The tightest member's limit, so no member is asked for more than it takes.
    batchSize: Math.min(...members.map((member) => member.batchSize)),
    get tokenizer() {
      return members[0].tokenizer;
    },

    async load() {
      // Sequentially: two ONNX sessions warming at once on the same cores is
      // slower than one after the other, and the download is the wait anyway.
      for (const member of members) await member.load();
    },

    countTokens: (text) => members[0].countTokens(text),

    /**
     * Ask every member, then route each question to one of them.
     *
     * The expert is chosen per question, not per claim, and that distinction
     * is the whole design. A choice's labels are compared against each other,
     * so they have to come from one model on one scale: picking the strongest
     * opinion claim by claim lets label A come from one model and label B from
     * another, and the argmax flips. Measured, that took a routing test from
     * 9/9 — which both members score alone — down to 6/9.
     *
     * Within a question, the member that found the most support anywhere in it
     * wins, and its whole distribution is used. That is the member that
     * understood what was being asked.
     */
    async entailment(pairs) {
      const answers = [];
      let inputTokens = 0;
      for (const member of members) {
        const scored = await member.entailment(pairs);
        answers.push(scored);
        inputTokens += scored.inputTokens;
      }

      // Claim indices per question, in the order the engine supplied them.
      const groups = new Map();
      pairs.forEach((pair, i) => {
        const key = pair.group ?? i;
        const claims = groups.get(key) ?? [];
        claims.push(i);
        groups.set(key, claims);
      });

      const entail = new Array(pairs.length);
      for (const claims of groups.values()) {
        let expert = 0;
        let strongest = -Infinity;
        answers.forEach((answer, m) => {
          const best = Math.max(...claims.map((i) => answer.entail[i]));
          if (best > strongest) {
            strongest = best;
            expert = m;
          }
        });
        for (const i of claims) entail[i] = answers[expert].entail[i];
      }

      return { entail, inputTokens };
    },

    async dispose() {
      for (const member of members) await member.dispose();
    },
  };
}
