// The playground.
//
// Two ways to run the same engine: post to the Node server that served this
// page, or download the model and run it in this tab. The request and the
// response are identical either way, which is the point being demonstrated.

import { asPercent, barWidth, columnHeight, needleOffset, pixels } from "./format.js";

const $ = (id) => document.getElementById(id);

const EXAMPLE = {
  // No spare fields. Everything in the state goes into the premise, and a line
  // that has nothing to do with the question still dilutes it: carrying a
  // `source: "a message to a friend"` here moved this score's two contending
  // levels from 34/60 to 24/75. Send the state a question needs.
  state: {
    text: "We drove the new route on Saturday. The whole trip took about an hour, mostly because of the roadworks near the bridge. It was about 40 minutes longer.",
  },
  // Levels 1 and 2 are both true of this state: it took about an hour, and it
  // was 40 minutes longer. So they should come out level, and on the default
  // model they do — 49% and 51%. Level 1 needs the step from "about an hour"
  // to "between half an hour and two hours", which is the thing most of these
  // models cannot do: switch to `nli-small` and it collapses to 34/60.
  questions: {
    by_car: {
      type: "noul",
      instructions: "The writer travelled by car.",
    },
    cause: {
      type: "choice",
      instructions: "What slowed the journey down?",
      criteria: {
        roadworks: "Construction or roadworks held them up.",
        traffic: "Ordinary traffic held them up.",
        weather: "Bad weather held them up.",
        unstated: "The text does not say what slowed them down.",
      },
    },
    how_long: {
      type: "score",
      instructions: "How long did the journey take?",
      criteria: [
        "The journey took less than half an hour.",
        "The journey took between half an hour and two hours.",
        "The journey was longer than normal.",
        "The journey took more than two hours.",
      ],
    },
  },
};

const FALLBACK_MODELS = [
  { name: "vej-latest", description: "nli-small + zeroshot-base, routed per question, 416 MB" },
  { name: "vej-small", description: "nli-distil + zeroshot-xsmall, 155 MB" },
  { name: "zeroshot-base", description: "DeBERTa-v3-base, zero-shot trained, 244 MB" },
  { name: "zeroshot-xsmall", description: "The same training, 87 MB" },
  { name: "nli-small", description: "DeBERTa-v3-small on plain MNLI, 172 MB" },
  { name: "nli-distil", description: "DistilBERT on MNLI, 68 MB" },
];

// --- small DOM helpers ------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/**
 * A probability, as text to read. Never as a CSS value — see `format.js`.
 *
 * Imported rather than reimplemented: the rule belongs with the probability
 * scale in `words.js`, and a second copy here is how the page came to print
 * "100%" beside the phrase "almost certainly".
 */
const pct = asPercent;

// --- editors ----------------------------------------------------------------

/** A textarea with a line-number gutter and live JSON validation. */
function editor(id, onChange) {
  const area = $(id);
  const gutter = $(`${id}-gutter`);
  const status = $(`${id}-status`);

  // The text wraps, so a logical line can occupy several rows and the gutter
  // cannot just stack equal-height numbers. This hidden copy is laid out under
  // the same rules and measured.
  const mirror = el("div", { class: "mirror" });
  area.parentNode.append(mirror);

  const measure = () => {
    const lines = area.value.split("\n");
    mirror.style.width = `${area.clientWidth}px`;
    mirror.replaceChildren(
      // A blank line still occupies a row; a zero-width space keeps it there.
      ...lines.map((line) => el("div", { text: line || "​" })),
    );
    gutter.replaceChildren(
      ...lines.map((_, i) =>
        el("div", { text: String(i + 1), style: { height: pixels(mirror.children[i].offsetHeight) } }),
      ),
    );
  };

  const refresh = () => {
    measure();
    try {
      JSON.parse(area.value);
      status.textContent = "";
      status.classList.remove("error");
    } catch (error) {
      status.textContent = error.message.replace(/^JSON\.parse: /, "");
      status.classList.add("error");
    }
    onChange?.();
  };

  area.addEventListener("input", refresh);
  area.addEventListener("scroll", () => {
    gutter.scrollTop = area.scrollTop;
  });
  // Resizing changes where every line wraps.
  new ResizeObserver(measure).observe(area);
  area.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = area;
    area.value = `${value.slice(0, start)}  ${value.slice(end)}`;
    area.selectionStart = area.selectionEnd = start + 2;
    refresh();
  });

  return {
    get value() {
      return area.value;
    },
    set value(text) {
      area.value = text;
      refresh();
    },
    parse() {
      return JSON.parse(area.value);
    },
    valid() {
      try {
        JSON.parse(area.value);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// --- results ----------------------------------------------------------------

/** One `name ▮▮▮▮ 42%` row, with the description under it when there is one. */
function row(name, probability, { won = false, description = null } = {}) {
  const node = el("div", { class: won ? "row won" : "row" }, [
    el("span", { class: "name", text: name }),
    // Geometry from `barWidth`, text from `pct`. They are not
    // interchangeable — see `format.js`.
    el("span", { class: "track" }, el("div", { class: "fill", style: { width: barWidth(probability) } })),
    el("span", { class: "pct", text: pct(probability) }),
  ]);
  if (description) node.append(el("span", { class: "desc", text: description }));
  return node;
}

/**
 * A score, drawn as what it is.
 *
 * Its levels are an ordered scale, so they are plotted in rubric order as
 * columns rather than sorted by size the way an unordered choice's labels are,
 * and the score is marked where it actually falls — usually between two
 * levels, which is the part a list of bars cannot show. One series, so no
 * legend: the most likely level is emphasised and the rest recede.
 *
 * The rows underneath are the table view. They carry every value without a
 * hover, which is what lets the chart label selectively.
 */
function scoreChart(answer) {
  const levels = Object.entries(answer.probabilities);
  const top = levels.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const highest = Math.max(...levels.map(([, p]) => p));

  const column = ([level, p]) => {
    const description = describe(answer.legend?.[level]);
    return el(
      "div",
      {
        class: level === top ? "col modal" : "col",
        // The hit target is the whole band, not the painted bar.
        title: `Level ${level} — ${pct(p)}${description ? `\n${description}` : ""}`,
      },
      [
        el("span", { class: "cap", text: pct(p) }),
        // Heights are relative to the tallest bar, so a decided distribution
        // and a spread one both use the full plot.
        el("div", { class: "bar", style: { height: columnHeight(p, highest) } }),
      ],
    );
  };

  const at = needleOffset(answer.score, levels.length);

  return [
    el("div", { class: "chart" }, [
      el("div", { class: "plot" }, levels.map(column)),
      el(
        "div",
        { class: "axis" },
        levels.map(([level]) => el("span", { text: level })),
      ),
      el(
        "div",
        { class: "needle" },
        el("div", { style: { left: at } }, [
          el("div", { class: "pin" }),
          // No phrase here. A score is a position on the rubric, not a
          // probability, and a probability word beside it reads as though the
          // score itself were "about even". The phrase belongs on the level it
          // describes, below.
          el("span", { class: "value", text: answer.score.toFixed(2) }),
        ]),
      ),
    ]),
    el(
      "div",
      { class: "levels" },
      levels.map(([level, p]) =>
        el("div", { class: level === top ? "modal" : "" }, [
          el("span", { class: "n", text: `level ${level}` }),
          el("span", { class: "p", text: pct(p) }),
          el("span", { text: describe(answer.legend?.[level]) ?? "" }),
        ]),
      ),
    ),
  ];
}

function headline(value, label) {
  return el("div", { class: "headline" }, [
    el("span", { class: "value", text: value }),
    el("span", { class: "label", text: label }),
  ]);
}

function answerBody(answer, question) {
  if (answer.type === "noul") {
    return [
      headline(pct(answer.noul), answer.phrase ? `${answer.phrase} true` : "true"),
      row("true", answer.noul, { won: answer.noul >= 0.5 }),
      row("false", 1 - answer.noul, { won: answer.noul < 0.5 }),
    ];
  }

  if (answer.type === "choice") {
    const entries = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    const won = pct(answer.probabilities[answer.choice]);
    return [
      headline(answer.choice, answer.phrase ? `${won} · ${answer.phrase}` : won),
      ...entries.map(([label, p]) =>
        row(label, p, { won: label === answer.choice, description: describe(question?.criteria?.[label]) }),
      ),
    ];
  }

  return scoreChart(answer);
}

const describe = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

function card(name, answer, question, meta) {
  const instructions = describe(question?.instructions);
  return el("div", { class: "card" }, [
    el("div", { class: "topline" }, [
      el("span", { class: "key", text: name }),
      el("span", { class: "spacer" }),
      el("span", { class: "badge", text: answer.type }),
    ]),
    instructions ? el("div", { class: "instructions", text: instructions }) : null,
    ...answerBody(answer, question),
    el(
      "div",
      { class: "meta" },
      meta.map((text) => el("span", { text })),
    ),
  ]);
}

function renderResults(result, elapsed, request) {
  const results = $("results");
  results.replaceChildren();
  const names = Object.keys(request.questions);
  for (const name of names) {
    const answer = result.answers[name];
    if (!answer) continue;
    const meta = [result.model, `${elapsed} ms total`];
    if (answer.confidence !== undefined) meta.push(`confidence ${answer.confidence.toFixed(2)}`);
    meta.push(`${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
    results.append(card(name, answer, request.questions[name], meta));
  }
  $("ran").textContent = `Ran just now · ${elapsed} ms`;
}

function renderError(message) {
  $("results").replaceChildren(el("div", { class: "empty" }, el("strong", { text: message })));
}

// --- running ----------------------------------------------------------------

let browserClient = null;
let browserModel = null;

/** Load Vej and the model into this tab. Slow once, then cached by the browser. */
async function inBrowser(model, onProgress) {
  if (browserClient && browserModel === model) return browserClient;
  const { VejClient } = await import("../src/index.js");
  browserClient = new VejClient({ runtimeOptions: { model, onProgress } });
  browserModel = model;
  await browserClient.load();
  return browserClient;
}

async function run() {
  const stateEditor = editors.state;
  const questionsEditor = editors.questions;
  if (!stateEditor.valid() || !questionsEditor.valid()) {
    renderError("Fix the JSON on the left first.");
    return;
  }

  const request = {
    state: stateEditor.parse(),
    questions: questionsEditor.parse(),
    model: $("model").value,
    // A bare 0.53 reads as more precise than the judgment is. The word says
    // what the number is worth.
    words: true,
  };

  const button = $("run");
  const status = $("status");
  const progress = $("progress");
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = "Running…";
  const started = performance.now();

  try {
    let result;
    if ($("where").value === "browser") {
      progress.hidden = false;
      const client = await inBrowser(request.model, (event) => {
        if (event.status === "progress") {
          progress.firstElementChild.style.width = `${event.progress ?? 0}%`;
          status.textContent = `Loading ${event.file} · ${Math.round(event.progress ?? 0)}%`;
        }
      });
      status.textContent = "Running…";
      result = await client.systemOne(request);
    } else {
      const response = await fetch("/v1/systemone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      result = body;
    }
    renderResults(result, Math.round(performance.now() - started), request);
    status.textContent = "";
  } catch (error) {
    status.textContent = "Failed";
    status.classList.add("error");
    renderError(error.message);
  } finally {
    button.disabled = false;
    progress.hidden = true;
  }
}

// --- sharing ----------------------------------------------------------------

const encode = (value) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const decode = (text) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
    ),
  );

function load() {
  if (location.hash.length <= 1) return null;
  try {
    return decode(location.hash.slice(1));
  } catch {
    return null;
  }
}

// --- wiring -----------------------------------------------------------------

const editors = {
  state: editor("state"),
  questions: editor("questions"),
};

function fill({ state, questions, model }) {
  editors.state.value = JSON.stringify(state, null, 2);
  editors.questions.value = JSON.stringify(questions, null, 2);
  if (model) $("model").value = model;
}

async function loadModels() {
  const select = $("model");
  let models = FALLBACK_MODELS;
  try {
    const response = await fetch("/v1/models");
    if (response.ok) models = (await response.json()).data;
  } catch {
    // A static deployment has no server to ask; the list above is the same one.
  }
  select.replaceChildren(
    ...models.map(({ name, description }) => el("option", { value: name, title: description, text: name })),
  );
}

/** Wire a button that copies `text()` and says so briefly. */
function copyButton(id, text) {
  const button = $(id);
  const resting = button.textContent.trim();
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      button.textContent = "copied";
    } catch {
      button.textContent = "blocked";
    }
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = resting;
      button.classList.remove("done");
    }, 1200);
  });
}

/** One editor's contents, pretty-printed when it parses and raw when it does not. */
const fromEditor = (id) => () =>
  editors[id].valid() ? JSON.stringify(editors[id].parse(), null, 2) : editors[id].value;

copyButton("state-copy", fromEditor("state"));
copyButton("questions-copy", fromEditor("questions"));

// The whole request, ready to paste into a fetch or a curl: state and
// questions together, with the model, in the shape the API takes.
copyButton("request-copy", () => {
  if (!editors.state.valid() || !editors.questions.valid()) {
    return `{\n  "state": ${editors.state.value},\n  "questions": ${editors.questions.value}\n}`;
  }
  return JSON.stringify(
    {
      state: editors.state.parse(),
      questions: editors.questions.parse(),
      model: $("model").value,
      words: true,
    },
    null,
    2,
  );
});

$("run").addEventListener("click", run);
$("clear").addEventListener("click", () => {
  history.replaceState(null, "", location.pathname);
  fill(EXAMPLE);
  $("results").replaceChildren(el("div", { class: "empty", text: "Cleared. Press ⌘↵ to run." }));
  $("ran").textContent = "";
});
$("share").addEventListener("click", async () => {
  if (!editors.state.valid() || !editors.questions.valid()) return;
  const hash = encode({
    state: editors.state.parse(),
    questions: editors.questions.parse(),
    model: $("model").value,
  });
  const url = `${location.origin}${location.pathname}#${hash}`;
  history.replaceState(null, "", `#${hash}`);
  try {
    await navigator.clipboard.writeText(url);
    $("status").textContent = "Link copied";
  } catch {
    $("status").textContent = "Link is in the address bar";
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    run();
  }
});

// A page opened from the filesystem has no server to post to.
if (location.protocol === "file:") $("where").value = "browser";

await loadModels();
fill(load() ?? EXAMPLE);
