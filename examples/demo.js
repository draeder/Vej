// The three primitives, in one request, against a local model.
//
//   node examples/demo.js
//   node examples/demo.js nli-small
//
// The first run downloads the model; later runs read it from the cache.

import { asPercent, choice, noul, probabilityFor, score, VejClient } from "../src/index.js";

const client = new VejClient({
  defaultModel: process.argv[2] ?? process.env.VEJ_MODEL,
  runtimeOptions: {
    onProgress: ({ status, file, progress }) => {
      if (status === "progress" && progress) {
        process.stderr.write(`\r  ${file} ${Math.round(progress)}%   `);
      }
      if (status === "done") process.stderr.write(`\r  ${file} ready            \n`);
    },
  },
});

const request = {
  // Everything in the state goes into the premise, and a field a question does
  // not need still dilutes it — see the README. Send only what is being asked
  // about.
  state: {
    text:
      "We drove the new route on Saturday. The whole trip took about an hour, mostly because of " +
      "the roadworks near the bridge.",
  },
  // Two rules are doing work here.
  //
  // All three ask what the text says. How it says it — its tone, its register,
  // how sure the writer sounds — is a different kind of question, and the
  // default backend answers those confidently and wrongly.
  //
  // And the score's levels name their own thresholds. "A little longer" and
  // "much longer" would need a baseline to compare against, which neither
  // backend supplies even when the state contains one.
  questions: {
    by_car: noul("The writer travelled by car."),
    cause: choice("What slowed the journey down?", {
      roadworks: "Construction or roadworks held them up.",
      traffic: "Ordinary traffic held them up.",
      weather: "Bad weather held them up.",
      unstated: "The text does not say what slowed them down.",
    }),
    how_long: score("How long did the journey take?", [
      "The journey took less than half an hour.",
      "The journey took between half an hour and two hours.",
      "The journey took more than two hours.",
    ]),
  },
  words: true,
};

console.log("plan:", JSON.stringify(await client.plan(request), null, 2));

const started = Date.now();
const { answers, model, usage } = await client.systemOne(request);
const elapsed = Date.now() - started;

console.log(`\n${model} · ${elapsed} ms · ${usage.input_tokens} in / ${usage.output_tokens} out\n`);
const top = request.questions.how_long.criteria.length - 1;
console.log(`by_car    ${asPercent(answers.by_car.noul)} — ${answers.by_car.phrase} true`);
console.log(`cause     ${answers.cause.choice} (${answers.cause.phrase})`);
console.log(
  `how_long  ${answers.how_long.score.toFixed(2)} on a 0–${top} scale ` +
    `— ${answers.how_long.legend[Math.round(answers.how_long.score)]}`,
);

// The judgments are data. What to do with them is code, and stays code — and
// the threshold says what it means instead of being a magic 0.75.
if (answers.by_car.noul > probabilityFor("likely") && answers.cause.choice !== "unstated") {
  console.log(`\n→ a car trip delayed by ${answers.cause.choice}`);
} else {
  console.log("\n→ not enough here to file it");
}

await client.dispose();
