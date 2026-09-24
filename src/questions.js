// The question layer. These are the same three primitives the TypeSafe SDK
// exposes, with the same argument order and the same object shape, so a
// question written for Jev is a question Vej accepts, and the other way round.

import { InvalidRequestError } from "./errors.js";

/** A yes/no question. `criteria` optionally describes each outcome. */
export const noul = (instructions = null, criteria) =>
  criteria === undefined ? { type: "noul", instructions } : { type: "noul", instructions, criteria };

/** A question that selects one label from `criteria`, a map of label to description. */
export const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });

/** A question scored against an ordered rubric: at least two levels, indexed from zero. */
export const score = (instructions, criteria) => ({ type: "score", instructions, criteria });

const MAX_CHOICES = 255;
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;

/**
 * Reject a request before any of it reaches the model.
 *
 * The limits are the API's, not the engine's: 255 choice labels, 2 to 10 score
 * levels. Checking here means a bad request costs nothing and fails with the
 * same message whether it arrived in process or over HTTP.
 */
export function validateRequest(request) {
  if (!request || typeof request !== "object") {
    throw new InvalidRequestError("A request must be an object with `state` and `questions`.");
  }
  if (!("state" in request)) {
    throw new InvalidRequestError("A request must include `state`, even if it is null.");
  }
  const { questions } = request;
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    throw new InvalidRequestError("`questions` must be an object keyed by question name.");
  }
  const names = Object.keys(questions);
  if (!names.length) throw new InvalidRequestError("`questions` must not be empty.");
  for (const name of names) validateQuestion(name, questions[name]);
  return request;
}

function validateQuestion(name, question) {
  const at = `questions.${name}`;
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new InvalidRequestError(`${at} must be a question object.`);
  }
  switch (question.type) {
    case "noul": {
      const { criteria } = question;
      if (criteria != null && (typeof criteria !== "object" || Array.isArray(criteria))) {
        throw new InvalidRequestError(`${at}.criteria must be an object with \`true\` and \`false\`.`);
      }
      return;
    }
    case "choice": {
      const { criteria } = question;
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
        throw new InvalidRequestError(`${at}.criteria must be a map of label to description.`);
      }
      const labels = Object.keys(criteria);
      if (labels.length < 2) {
        throw new InvalidRequestError(`${at}.criteria needs at least two labels.`);
      }
      if (labels.length > MAX_CHOICES) {
        throw new InvalidRequestError(`${at}.criteria has ${labels.length} labels; the limit is ${MAX_CHOICES}.`);
      }
      return;
    }
    case "score": {
      const { criteria } = question;
      if (!Array.isArray(criteria) || criteria.length < MIN_LEVELS) {
        throw new InvalidRequestError(
          `${at}.criteria must be a list of at least ${MIN_LEVELS} level descriptions.`,
        );
      }
      if (criteria.length > MAX_LEVELS) {
        throw new InvalidRequestError(`${at}.criteria has ${criteria.length} levels; the limit is ${MAX_LEVELS}.`);
      }
      return;
    }
    default:
      throw new InvalidRequestError(
        `${at}.type must be "noul", "choice" or "score"; got ${JSON.stringify(question.type)}.`,
      );
  }
}

/** The outcomes a question can answer with, in the order they are presented. */
export function outcomesOf(question) {
  switch (question.type) {
    case "noul":
      return ["true", "false"];
    case "choice":
      return Object.keys(question.criteria);
    case "score":
      return question.criteria.map((_, i) => String(i));
    default:
      return [];
  }
}

/** The description attached to one outcome, or null when it has none. */
export function describeOutcome(question, outcome) {
  switch (question.type) {
    case "noul":
      return question.criteria?.[outcome] ?? null;
    case "choice":
      return question.criteria[outcome] ?? null;
    case "score":
      return question.criteria[Number(outcome)] ?? null;
    default:
      return null;
  }
}
