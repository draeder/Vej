// The runtime.
//
// A cross-encoder trained on natural language inference already does the thing
// a noul asks for: given a premise, how much does this claim follow? It is
// bidirectional and has no decoder, so a judgment costs milliseconds.
//
// It reads every hypothesis independently, which has a pleasant side effect: a
// choice here cannot have position bias, because the options are never in a
// list for the model to prefer the top of.

import { normalize } from "../decode.js";
import { RuntimeError } from "../errors.js";
import { defaultDtype, resolveModel } from "../models.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/**
 * Create a runtime backed by an NLI cross-encoder.
 *
 * @param {object} [options]
 * @param {string} [options.model] Short name from the registry or a repository id.
 * @param {string} [options.device] `webgpu`, `wasm`, `cpu`, or `auto`.
 * @param {string} [options.dtype] Weight dtype. Defaults to the model's own, see `models.js`.
 * @param {number} [options.maxLength] Longest premise plus hypothesis, in tokens.
 * @param {number} [options.batchSize] Pairs per forward pass.
 * @param {(progress: object) => void} [options.onProgress] Load progress, for a UI.
 * @param {object} [options.transformers] A preloaded transformers.js module.
 */
export function createEntailmentRuntime({
  model: name = null,
  device = "auto",
  dtype = null,
  maxLength = 512,
  batchSize = 32,
  onProgress = null,
  transformers = null,
} = {}) {
  const repo = resolveModel(name);
  const weights = dtype ?? defaultDtype(repo);
  let lib = transformers;
  let tokenizer = null;
  let model = null;
  let entailmentColumn = 1;

  const resolvedDevice = device !== "auto" ? device : isBrowser ? "webgpu" : "cpu";

  return {
    get id() {
      return `vej/${repo}`;
    },
    repo,
    device: resolvedDevice,
    dtype: weights,
    batchSize,
    get tokenizer() {
      return tokenizer;
    },

    async load() {
      if (model) return;
      lib ??= await import("@huggingface/transformers").catch((cause) => {
        throw new RuntimeError(
          "Could not import @huggingface/transformers. Install it, or pass a loaded module as `transformers`.",
          { cause },
        );
      });
      try {
        tokenizer = await lib.AutoTokenizer.from_pretrained(repo, { progress_callback: onProgress });
        model = await lib.AutoModelForSequenceClassification.from_pretrained(repo, {
          device: resolvedDevice,
          dtype: weights,
          progress_callback: onProgress,
        });
      } catch (cause) {
        throw new RuntimeError(`Could not load ${repo} on ${resolvedDevice}/${weights}.`, { cause });
      }

      // Which output column means "follows from the premise". Every head
      // orders its own labels; guessing is how you ship a model that reports
      // the confident opposite of what it found.
      //
      // Both schemes in the wild work, and only this one column is read from
      // either. A three-way NLI head has entailment / neutral / contradiction;
      // a head trained directly for zero-shot classification is usually binary,
      // entailment / not_entailment. Requiring a contradiction label would
      // exclude the binary ones, and they include the only model measured here
      // that can place "about an hour" inside "half an hour to two hours".
      const labels = model.config.id2label ?? {};
      const entry = Object.entries(labels).find(([, label]) => /^entail/i.test(String(label)));
      if (!entry) {
        throw new RuntimeError(
          `${repo} has no entailment label; its config has ${JSON.stringify(labels)}. ` +
            "Vej needs a natural language inference or zero-shot classification head.",
        );
      }
      entailmentColumn = Number(entry[0]);
    },

    countTokens: (text) => tokenizer.encode(text).length,

    /**
     * Score claims against premises.
     *
     * The log-probability of entailment, taken over the model's whole label
     * set — not against contradiction alone. The difference matters when a
     * premise simply has nothing to say about a claim: that mass belongs to
     * `neutral`, and only the full distribution lets it read as "no". Scored
     * two-way, an unmentioned claim comes back a coin flip, and a premise that
     * merely fails to contradict a claim comes back a confident yes.
     */
    async entailment(pairs) {
      const entail = new Array(pairs.length);
      let inputTokens = 0;

      for (let start = 0; start < pairs.length; start += batchSize) {
        const batch = pairs.slice(start, start + batchSize);
        const inputs = tokenizer(
          batch.map((pair) => pair.premise),
          {
            text_pair: batch.map((pair) => pair.hypothesis),
            padding: true,
            truncation: true,
            max_length: maxLength,
          },
        );
        const { logits } = await model(inputs);
        const [rows, columns] = logits.dims;
        const data = logits.type === "float32" ? logits.data : logits.to("float32").data;
        for (let row = 0; row < rows; row++) {
          const scores = Array.from({ length: columns }, (_, column) => data[row * columns + column]);
          entail[start + row] = Math.log(normalize(scores)[entailmentColumn]);
        }
        const mask = inputs.attention_mask;
        if (mask) inputTokens += mask.data.reduce((total, value) => total + Number(value), 0);
      }

      return { entail, inputTokens };
    },

    async dispose() {
      await model?.dispose();
      model = null;
    },
  };
}
