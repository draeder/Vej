// Picking a runtime for a model name.
//
// A name is either an ensemble — several models with a rule for choosing
// between them, which is the default — or one model on its own.

import { ensembleFor } from "../models.js";
import { createEnsembleRuntime } from "./ensemble.js";
import { createEntailmentRuntime } from "./entailment.js";

export { createEnsembleRuntime } from "./ensemble.js";
export { createEntailmentRuntime } from "./entailment.js";
export { createMockRuntime } from "./mock.js";

/**
 * Build the runtime a model name asks for.
 *
 * @param {object} [options] Passed through; `model` decides what is built.
 */
export function createRuntime({ model, ...shared } = {}) {
  const members = ensembleFor(model);
  return members
    ? createEnsembleRuntime({ ...shared, models: members })
    : createEntailmentRuntime({ ...shared, model });
}
