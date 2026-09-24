import { phraseFor } from "./words.js";

// Turning a distribution into an answer.
//
// Everything here is arithmetic over log-probabilities the runtime already
// produced. No model is involved, so it is synchronous, deterministic, and
// testable without one.

/** Softmax over log-probabilities, with an optional log-prior subtracted first. */
export function normalize(logprobs, { prior = null, temperature = 1 } = {}) {
  const adjusted = logprobs.map((value, i) => (value - (prior ? prior[i] : 0)) / temperature);
  const max = Math.max(...adjusted);
  if (!Number.isFinite(max)) return logprobs.map(() => 1 / logprobs.length);
  const weights = adjusted.map((value) => Math.exp(value - max));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

/**
 * How concentrated a distribution is, from 0 to 1.
 *
 * All the mass on one outcome gives 1; spread evenly across them gives 0. This
 * says how decided the answer was, not whether it was right.
 */
export function confidenceOf(probabilities) {
  const n = probabilities.length;
  if (n < 2) return 1;
  let entropy = 0;
  for (const p of probabilities) if (p > 0) entropy -= p * Math.log(p);
  return clamp01(1 - entropy / Math.log(n));
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const round = (value, places = 6) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Round a distribution for the wire, keeping the sum at exactly 1.
 *
 * The residual goes on the largest entry, where it is proportionally smallest.
 */
function roundDistribution(probabilities) {
  const rounded = probabilities.map((p) => round(p));
  const total = rounded.reduce((a, b) => a + b, 0);
  const residual = round(1 - total);
  if (residual !== 0 && rounded.length) {
    let largest = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[largest]) largest = i;
    rounded[largest] = round(rounded[largest] + residual);
  }
  return rounded;
}

/**
 * Assemble the answer for one question.
 *
 * The shapes are the API's: a noul is one number and nothing else, a choice
 * carries the selected label with the full distribution, a score carries the
 * expected level with the rubric it was read against.
 */
export function buildAnswer(question, outcomes, probabilities, { words = false } = {}) {
  const probs = roundDistribution(probabilities);
  // `phrase` is additive and off by default, so the answer keeps exactly the
  // shape the API returns unless it was asked for.
  const said = (probability) => (words ? { phrase: phraseFor(probability) } : null);
  switch (question.type) {
    case "noul": {
      const value = probs[outcomes.indexOf("true")];
      return { type: "noul", noul: value, ...said(value) };
    }
    case "choice": {
      let best = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
      return {
        type: "choice",
        choice: outcomes[best],
        confidence: round(confidenceOf(probabilities)),
        probabilities: Object.fromEntries(outcomes.map((label, i) => [label, probs[i]])),
        ...said(probs[best]),
      };
    }
    case "score": {
      let expected = 0;
      for (let i = 0; i < probs.length; i++) expected += i * probabilities[i];
      // No phrase. A score is a position on a rubric, not a probability, so
      // there is nothing here for a probability word to name: put it on the
      // score and it reads as though the score were "about even", put it on
      // the most likely level and it restates that level's own percentage.
      return {
        type: "score",
        score: round(expected),
        confidence: round(confidenceOf(probabilities)),
        legend: Object.fromEntries(question.criteria.map((description, i) => [i, description])),
        probabilities: Object.fromEntries(outcomes.map((level, i) => [level, probs[i]])),
      };
    }
    default:
      throw new Error(`Unknown question type ${question.type}.`);
  }
}
