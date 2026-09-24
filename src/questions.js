// The question layer. These are the same three primitives the TypeSafe SDK
// exposes, with the same argument order and the same object shape, so a
// question written for Jev is a question Vej accepts, and the other way round.

import { UsageError, ValidationError } from "./errors.js";

/** A yes/no question. `criteria` optionally describes each outcome. */
export const noul = (instructions = null, criteria) =>
  criteria === undefined ? { type: "noul", instructions } : { type: "noul", instructions, criteria };

/** A question that selects one label from `criteria`, a map of label to description. */
export const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });

/** A question scored against an ordered rubric: at least two levels, indexed from zero. */
export const score = (instructions, criteria) => ({ type: "score", instructions, criteria });

const MAX_CHOICES = 255;
const MAX_LEVELS = 10;

/**
 * Reject a request before any of it reaches the model.
 *
 * Every rule and every message here was read off the hosted API rather than
 * reasoned about, and `parity/` checks they still agree. Two of them are
 * surprising: a single choice label and a single score level are both
 * accepted, even though the SDK's own types say two, because the server takes
 * them. Vej is the server.
 */
export function validateRequest(request) {
  if (!request || typeof request !== "object") {
    throw new UsageError("Invalid request.", { type: "api_usage_error" });
  }
  const { questions } = request;
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    throw missingField("questions", request);
  }
  const names = Object.keys(questions);
  if (!names.length) {
    throw new ValidationError([
      {
        type: "too_short",
        loc: ["body", "questions"],
        msg: "Dictionary should have at least 1 item after validation, not 0",
        input: questions,
        ctx: { field_type: "Dictionary", min_length: 1, actual_length: 0 },
      },
    ]);
  }
  for (const name of names) validateQuestion(name, questions[name]);
  return request;
}

/** The shape a schema validator reports a missing field with. */
export const missingField = (field, input) =>
  new ValidationError([{ type: "missing", loc: ["body", field], msg: "Field required", input }]);

const hasText = (value) => value !== null && value !== undefined && value !== "";

function validateQuestion(name, question) {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new UsageError("Invalid request.", { type: "api_usage_error" });
  }
  switch (question.type) {
    case "noul": {
      const { criteria, instructions } = question;
      if (!hasText(instructions) && !hasText(criteria)) {
        throw new UsageError(`Noul question must have criteria or instructions: ${name}`);
      }
      return;
    }
    case "choice": {
      const { criteria } = question;
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
        throw new UsageError("Invalid request.", { type: "api_usage_error" });
      }
      if (Object.keys(criteria).length > MAX_CHOICES) {
        throw new UsageError(`Too many choices. Must have at most ${MAX_CHOICES} choices.`);
      }
      return;
    }
    case "score": {
      const { criteria } = question;
      if (!Array.isArray(criteria) || criteria.length === 0) {
        throw new UsageError("Invalid request.", { type: "api_usage_error" });
      }
      if (criteria.length > MAX_LEVELS) {
        throw new UsageError(`Too many score levels. Must have at most ${MAX_LEVELS} levels.`);
      }
      return;
    }
    default:
      throw new UsageError("Invalid request.", { type: "api_usage_error" });
  }
}

/**
 * The parts of the contract that belong to the HTTP surface rather than the
 * engine: `state` and `model` are required of a request, and the model has to
 * be one this server has.
 *
 * In process there is no such requirement — `VejClient` fills the model in and
 * the engine only cares about the questions, the same way the SDK fills it for
 * a caller who never mentions one.
 */
export function validateApiRequest(body, isKnownModel) {
  if (!body || typeof body !== "object") throw missingField("state", body);
  if (!("state" in body) || body.state === null) throw missingField("state", body);
  if (!("model" in body) || body.model === null) throw missingField("model", body);
  validateRequest(body);
  if (!isKnownModel(body.model)) {
    throw new UsageError(`Unknown model: ${body.model}`, { type: "api_usage_error" });
  }
  return body;
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
