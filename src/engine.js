// The engine.
//
// A request arrives in the same shape the TypeSafe API takes, and leaves in the
// same shape it returns. In between, each outcome becomes a claim about the
// state, a cross-encoder says how far the state entails each claim, and
// arithmetic turns those into an answer.
//
// The model is never asked to write an answer, so it cannot write one that is
// not on the list. Everything outside the forward pass is ordinary code.

import { buildAnswer, normalize } from "./decode.js";
import { InvalidRequestError } from "./errors.js";
import { toHypotheses, toPremise } from "./hypotheses.js";
import { outcomesOf, validateRequest } from "./questions.js";

const DEFAULTS = {
  /** Divides the outcome log-odds. Above 1 softens answers, below 1 sharpens them. */
  temperature: 1,
  /**
   * Add a `phrase` to every answer: the probability word whose median meaning
   * is nearest the number. Reporting only — see `words.js`.
   */
  words: false,
};

/**
 * Stop waiting for `promise` if `signal` aborts.
 *
 * Callers use a signal as a deadline — SlopGateway's hooks have about four
 * seconds each — and the honest thing is to tell them when it has passed. What
 * is already running still runs: a forward pass is one call into ONNX Runtime
 * and cannot be cut in half. So this ends the wait, not the work, which is
 * what a caller about to give up on the answer actually needs.
 */
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export class Vej {
  #loaded = null;

  constructor({ runtime, ...options } = {}) {
    if (!runtime) throw new InvalidRequestError("Vej needs a runtime. See `src/runtime/`.", 500);
    this.runtime = runtime;
    this.options = { ...DEFAULTS, ...options };
  }

  /** The model identifier reported on every answer. */
  get model() {
    return this.runtime.id;
  }

  /** Load the model. Called on first use; call it early to control when the wait happens. */
  async load() {
    this.#loaded ??= this.runtime.load();
    await this.#loaded;
    return this;
  }

  /**
   * Plan a request without running it.
   *
   * Reports what a request would cost before anything is spent, and the exact
   * claims it will put to the model — which is usually the thing worth looking
   * at when an answer is surprising.
   */
  async plan(request) {
    validateRequest(request);
    await this.load();
    const passes = this.#compile(request);

    let pairs = 0;
    let inputTokens = 0;
    for (const pass of passes) {
      pairs += pass.hypotheses.length;
      for (const hypothesis of pass.hypotheses) {
        inputTokens += this.runtime.countTokens(`${pass.premise} ${hypothesis}`);
      }
    }
    const perPass = this.runtime.batchSize ?? Math.max(pairs, 1);

    return {
      model: this.model,
      premise: passes[0]?.premise ?? "",
      questions: passes.map((pass) => ({
        name: pass.name,
        type: pass.type,
        outcomes: pass.outcomes.length,
        hypotheses: pass.hypotheses,
      })),
      pairs,
      forwardPasses: Math.ceil(pairs / perPass),
      usage: { input_tokens: inputTokens, output_tokens: pairs },
    };
  }

  /**
   * Answer named questions about state.
   *
   * Questions in one request are answered in one batch and cannot see each
   * other's answers, exactly as they cannot on the hosted API.
   *
   * `options.signal` is a deadline, as it is on the SDK's client: loading the
   * weights is the long part, and a caller out of time stops waiting there
   * rather than at the end. See `abortable` for what that does and does not
   * stop.
   */
  async systemOne(request, { signal } = {}) {
    validateRequest(request);
    // Before anything is started, not just before anything is awaited: a
    // caller whose budget is already gone should not pay to load the weights.
    signal?.throwIfAborted();
    await abortable(this.load(), signal);

    const passes = this.#compile(request);
    const usage = { input_tokens: 0, output_tokens: 0 };
    const scored = await this.#run(passes, usage, signal);

    // `words` is a Vej extension, accepted on the request the way `model` is,
    // so a caller going over HTTP can ask for it without a second endpoint.
    const words = request.words ?? this.options.words;
    const answers = {};
    passes.forEach((pass, i) => {
      const probabilities = normalize(scored[i], { temperature: this.options.temperature });
      answers[pass.name] = buildAnswer(pass.question, pass.outcomes, probabilities, { words });
    });

    return { model: this.model, answers, usage };
  }

  /** One question becomes one premise and one claim per outcome. */
  #compile(request) {
    const premise = toPremise(request.state);
    return Object.entries(request.questions).map(([name, question]) => ({
      name,
      type: question.type,
      question,
      outcomes: outcomesOf(question),
      premise,
      hypotheses: toHypotheses(question),
    }));
  }

  /**
   * Score every claim, for every question, in one call.
   *
   * The two primitives read the same three-way output differently, and the
   * difference is not cosmetic:
   *
   * A noul asks one claim and takes entailment over the model's whole label
   * set, reading `false` as the remainder. A state with nothing to do with the
   * claim lands in `neutral` and comes out a no, which is the right answer and
   * the one a two-hypothesis yes/no split gets wrong.
   *
   * A choice or a score asks one claim per outcome and reads the same number
   * for each, then normalizes across them.
   *
   * This used to drop `neutral` and compare entailment against contradiction,
   * `e / (e + c)`. That was measured, and it was right for the single small
   * MNLI model it was measured on — but it is wrong, and the reason is worth
   * keeping: an option nothing supports and nothing contradicts has e ≈ 0 and
   * c ≈ 0, so e/(e+c) ≈ 0.5. On "roadworks near the bridge", the option "bad
   * weather held them up" scored entail 0.001, contradict 0.001, neutral
   * 0.998 — and took 34% of the answer. A coin flip for something the text
   * never mentioned.
   *
   * Entailment over the whole label set has no such hole: 0.001 stays 0.001.
   * The case that originally ruled it out — a routing question the old model
   * got backwards — now scores 100% correct on the ensemble.
   */
  async #run(passes, usage, signal) {
    const pairs = [];
    const spans = passes.map((pass) => {
      const start = pairs.length;
      // `group` marks which claims belong to one question. A single model
      // ignores it; an ensemble needs it, because a choice's labels are only
      // comparable when one model scored all of them.
      for (const hypothesis of pass.hypotheses) {
        pairs.push({ premise: pass.premise, hypothesis, group: pass.name });
      }
      return { start, length: pairs.length - start };
    });

    const { entail, inputTokens } = await abortable(this.runtime.entailment(pairs), signal);
    usage.input_tokens += inputTokens;
    usage.output_tokens += pairs.length;

    return passes.map((pass, i) => {
      const { start, length } = spans[i];
      if (pass.type === "noul") {
        const yes = Math.min(Math.exp(entail[start]), 1);
        return [Math.log(yes), Math.log(1 - yes)];
      }
      return Array.from({ length }, (_, offset) => entail[start + offset]);
    });
  }
}

/** Create an engine. `runtime` is required; everything else has a default. */
export const createVej = (options) => new Vej(options);
