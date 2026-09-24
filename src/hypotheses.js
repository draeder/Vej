// Turning a question into entailment pairs.
//
// A cross-encoder reads a premise and a hypothesis and says whether one
// follows from the other. So state becomes a premise, and each outcome becomes
// a claim about it. This is a different rendering of the same question, not a
// different question: the answers come back in the API's shapes.

/** Collect leaf values, depth first, with the key each one sat under. */
function leaves(value, key, out) {
  if (value === null || value === undefined) return out;
  if (typeof value !== "object") {
    out.push([key, value]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) leaves(item, key, out);
    return out;
  }
  for (const [name, nested] of Object.entries(value)) leaves(nested, name, out);
  return out;
}

/**
 * The state, as a premise.
 *
 * A string is used as written. Structured state becomes prose: its text leaves
 * are laid out as sentences, and only the leaves that are not text keep their
 * key, because a number on its own says nothing.
 *
 * Not `key: "value"` lines, which is what this used to do. These models were
 * trained on sentences and a field dump measurably costs them: on one state,
 * a claim the text states outright scored 0.96 entailment as prose and 0.06
 * as key-value lines. The keys are worth less than the sentences they break.
 */
export function toPremise(state) {
  if (state === null || state === undefined) return "";
  if (typeof state === "string") return state;
  if (typeof state !== "object") return String(state);
  return leaves(state, "", [])
    .map(([key, value]) => (typeof value === "string" ? value : `${key}: ${JSON.stringify(value)}`))
    .join("\n");
}

const isSentence = (text) => /[.!?]$/.test(text.trim());

/** A description turned into something that reads as a claim. */
function asClaim(text, fallback) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return `This is ${fallback}.`;
  if (isSentence(trimmed)) return trimmed;
  return `This is ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}.`;
}

const describe = (value) =>
  value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

/**
 * The hypotheses for one question, in outcome order.
 *
 * A noul is the exception and gets one hypothesis rather than two: the
 * question itself as a claim. Its probability is then read as entailment
 * against the whole three-way distribution, so a premise that is merely
 * unrelated lands in `neutral` and counts as no. Splitting it into a `true`
 * and a `false` hypothesis throws that away and scores an irrelevant premise
 * as a confident yes.
 */
export function toHypotheses(question) {
  const instructions = describe(question.instructions).trim();
  switch (question.type) {
    case "noul":
      // The instruction is the claim. `criteria.true` is a note about where
      // the boundary falls, usually a sentence fragment with no subject
      // ("They ask for a person or an agent"), which reads as a hypothesis
      // about nobody and scores near zero. Fall back to it only when there is
      // no instruction at all.
      return [asClaim(instructions || describe(question.criteria?.true), "true of the text")];
    case "choice":
      return Object.entries(question.criteria).map(([label, description]) =>
        asClaim(describe(description), `about ${label}`),
      );
    case "score":
      return question.criteria.map((description, level) =>
        asClaim(describe(description), `at level ${level}`),
      );
    default:
      return [];
  }
}
