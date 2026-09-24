// Vej: a local Jev.
//
// Same three primitives, same request and response shapes, same idea — a model
// that returns a calibrated judgment rather than a paragraph — with the weights
// on the machine that asked. A cross-encoder does the judging; everything
// around it is code you can read.

export { Vej, createVej } from "./engine.js";
export { VejClient } from "./client.js";
export { choice, noul, score, validateRequest } from "./questions.js";
export {
  createEnsembleRuntime,
  createEntailmentRuntime,
  createMockRuntime,
  createRuntime,
} from "./runtime/index.js";
export { DEFAULT_MODEL, ENSEMBLES, MODELS, ensembleFor, modelCards, resolveModel } from "./models.js";
export { toHypotheses, toPremise } from "./hypotheses.js";
export { asPercent, phraseFor, probabilityFor, RESOLUTION, SCALE } from "./words.js";
export { InvalidRequestError, RuntimeError, VejError } from "./errors.js";

import { VejClient } from "./client.js";

/**
 * A ready client, which is what most callers want.
 *
 * ```js
 * const vej = createClient();
 * const { answers } = await vej.systemOne({
 *   state: "We drove the new route and the trip took about an hour.",
 *   questions: { by_car: noul("The writer travelled by car.") },
 * });
 * answers.by_car.noul; // 0.99
 * ```
 */
export const createClient = (config) => new VejClient(config);

/**
 * The same thing as the default export, so both spellings work:
 *
 * ```js
 * import vej from "vej";
 * import { createClient } from "vej";
 * ```
 */
export default createClient;
