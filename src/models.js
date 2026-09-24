// The models Vej will answer with.
//
// Short names exist so a request can say `nli-small` the way it would say
// `jev-latest`. Anything containing a slash is passed through as a repository
// id, so a local export or a model that is not on this list still works — it
// needs an `entailment` and a `contradiction` label in its config, which the
// runtime checks on load.

export const MODELS = {
  "zeroshot-base": {
    repo: "MoritzLaurer/deberta-v3-base-zeroshot-v1.1-all-33",
    dtype: "q8",
    download: "244 MB",
    description:
      "DeBERTa-v3-base trained directly for zero-shot classification on 33 datasets. " +
      "The only model measured here that reads worded units, and half of the default ensemble.",
  },
  "zeroshot-xsmall": {
    repo: "MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33",
    dtype: "q8",
    download: "87 MB",
    description: "The same training, a quarter the size. Faster and smaller; weaker on units.",
  },
  "nli-small": {
    repo: "Xenova/nli-deberta-v3-small",
    dtype: "q8",
    download: "172 MB",
    description: "DeBERTa-v3-small on plain MNLI. Fast, and cannot read “half an hour”.",
  },
  "nli-distil": {
    repo: "Xenova/distilbert-base-uncased-mnli",
    dtype: "q8",
    download: "68 MB",
    description: "DistilBERT on MNLI. The small, blunt option.",
  },
};

/**
 * Ensembles, by name.
 *
 * `vej-latest` is one of these rather than a single model, because no single
 * model measured here is good enough and their errors are one-sided in a way
 * that makes combining them work. See `runtime/ensemble.js`.
 */
export const ENSEMBLES = {
  "vej-latest": {
    models: ["nli-small", "zeroshot-base"],
    download: "416 MB",
    description:
      "nli-small and zeroshot-base, each claim answered by whichever found more support. " +
      "The default: 0/12 on the suite where the best single model scores 1/12.",
  },
  "vej-small": {
    models: ["nli-distil", "zeroshot-xsmall"],
    download: "155 MB",
    description: "The same idea at a third the size, for a browser tab.",
  },
};

export const DEFAULT_MODEL = "vej-latest";

/** The member models of an ensemble, or null if this names a single model. */
export function ensembleFor(name) {
  if (!name) return ENSEMBLES[DEFAULT_MODEL].models;
  if (name === "jev-latest") return ENSEMBLES[DEFAULT_MODEL].models;
  return ENSEMBLES[name.toLowerCase?.()]?.models ?? null;
}

const BY_REPO = new Map(Object.values(MODELS).map((model) => [model.repo, model]));

/** Resolve a single model name to a repository id. */
export function resolveModel(name) {
  if (!name) return MODELS["zeroshot-base"].repo;
  if (name.includes("/")) return name;
  return MODELS[name.toLowerCase()]?.repo ?? name;
}

/** The weight dtype to load a repository with. */
export function defaultDtype(repo) {
  return BY_REPO.get(repo)?.dtype ?? "q8";
}

/** The model list, in the shape `GET /v1/models` returns. Ensembles first. */
export const modelCards = () =>
  [...Object.entries(ENSEMBLES), ...Object.entries(MODELS)].map(([name, { description, download }]) => ({
    name,
    description: `${description} Downloads ${download}.`,
    release_date: "2026-04-14",
  }));
