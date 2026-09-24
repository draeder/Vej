// A client with the shape the TypeSafe SDK's client has.
//
// The point is substitutability. Code written against `TypeSafeClient` takes a
// `VejClient` without a change, so the same program can run against the hosted
// model or against a local one by swapping the object it was handed. There is
// no network here: the model is in the process.

import { Vej } from "./engine.js";
import { modelCards } from "./models.js";
import { createRuntime } from "./runtime/index.js";

export class VejClient {
  /**
   * @param {object} [config]
   * @param {object} [config.runtime] A runtime to use; one is built if absent.
   * @param {string} [config.defaultModel] Model used when a request omits one.
   * @param {number} [config.temperature] See `engine.js`.
   * @param {boolean} [config.words] Attach a probability phrase to every answer.
   * @param {object} [config.runtimeOptions] Passed to the runtime when one is built.
   */
  constructor({ runtime, defaultModel, runtimeOptions = {}, ...options } = {}) {
    this.defaultModel = defaultModel ?? runtimeOptions.model ?? "vej-latest";
    this.engine = new Vej({
      runtime: runtime ?? createRuntime({ ...runtimeOptions, model: this.defaultModel }),
      ...options,
    });
    this.models = { list: async () => modelCards() };
  }

  /** Load the model now rather than on the first question. */
  load() {
    return this.engine.load();
  }

  /**
   * Answer named questions about state.
   *
   * A `model` on the request is ignored: one client holds one set of weights,
   * and swapping several gigabytes underneath a request would be the wrong
   * surprise. Construct a second client to use a second model.
   *
   * `options.signal` works as it does on the SDK's client, so a caller using
   * one as a deadline keeps it when it swaps a `VejClient` in.
   */
  systemOne(request, options) {
    // The SDK fills `model` from its own default before sending, so code
    // written against it never names one. Do the same, or every in-process
    // caller would have to start.
    if (request && !("model" in request)) return this.engine.systemOne({ ...request, model: this.defaultModel }, options);
    return this.engine.systemOne(request, options);
  }

  /** What a request would cost, without running it. */
  plan(request) {
    return this.engine.plan(request);
  }

  dispose() {
    return this.engine.runtime.dispose?.();
  }
}
