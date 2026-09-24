#!/usr/bin/env node
// The command line. Three things: run the server, ask one question, list models.

import { readFileSync } from "node:fs";

import { VejClient } from "../src/client.js";
import { ENSEMBLES, MODELS } from "../src/models.js";
import { noul } from "../src/questions.js";
import { serve } from "../src/server.js";

const USAGE = `vej — a local Jev

  vej serve [options]            Serve the API and the playground
  vej ask <question> [options]   Ask one yes/no question and print the probability
  vej models                     List the models Vej knows by name

Options
  --port <n>        Server port. Default 8787.
  --host <addr>     Server address. Default 127.0.0.1.
  --api-key <key>   Require this bearer token on /v1/*. Default: open.
  --no-web          Serve only the API, not the playground.
  --model <name>    Ensemble, model, or Hugging Face repository. Default vej-latest.
  --device <dev>    webgpu, wasm, cpu, or auto. Default auto.
  --dtype <dtype>   Weight dtype, e.g. q8 or fp32. Default is the model's own.
  --state <text>    State for \`ask\`; a leading @ reads a file.
`;

/** Parse `--flag value` and `--no-flag` into an object. */
function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name.startsWith("no-")) {
      options[name.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) options[name] = true;
    else {
      options[name] = next;
      i += 1;
    }
  }
  return { options, positional };
}

const runtimeOptions = (options) => ({
  model: options.model,
  device: options.device,
  dtype: options.dtype,
  onProgress: (progress) => {
    if (progress.status === "progress" && progress.file?.endsWith(".onnx")) {
      process.stderr.write(`\r  ${progress.file} ${Math.round(progress.progress ?? 0)}%   `);
    }
    if (progress.status === "done") process.stderr.write(`\r  ${progress.file} done            \n`);
  },
});

async function commandServe(options) {
  const { url, vej } = await serve({
    port: Number(options.port ?? process.env.VEJ_PORT ?? 8787),
    host: options.host ?? "127.0.0.1",
    apiKey: options["api-key"] ?? process.env.VEJ_API_KEY ?? null,
    web: options.web !== false,
    engineOptions: { runtimeOptions: runtimeOptions(options) },
  });
  console.log(`vej listening on ${url}`);
  console.log(`  model      ${vej.model}`);
  console.log(`  api        POST ${url}/v1/systemone`);
  if (options.web !== false) console.log(`  playground ${url}/`);
  console.log(`\nPoint an existing TypeSafe client at it with TYPESAFE_BASE_URL=${url}`);
  console.log("The model loads on the first request.");
}

async function commandAsk(question, options) {
  if (!question) {
    console.error("vej ask needs a question.");
    process.exit(2);
  }
  let state = options.state ?? "";
  if (typeof state === "string" && state.startsWith("@")) state = readFileSync(state.slice(1), "utf8");

  const client = new VejClient({ words: true, runtimeOptions: runtimeOptions(options) });
  const { answers, usage, model } = await client.systemOne({
    state,
    questions: { answer: noul(question) },
  });
  console.log(`${answers.answer.noul.toFixed(4)}  ${answers.answer.phrase}`);
  console.error(`  ${model}  ${usage.input_tokens} in / ${usage.output_tokens} out`);
  await client.dispose();
}

function commandModels() {
  for (const [name, { models, download, description }] of Object.entries(ENSEMBLES)) {
    console.log(`${name.padEnd(22)} ${models.join(" + ")}`);
    console.log(`${" ".repeat(22)} ${description} Downloads ${download}.`);
  }
  for (const [name, { repo, description, download }] of Object.entries(MODELS)) {
    console.log(`${name.padEnd(22)} ${repo}`);
    console.log(`${" ".repeat(22)} ${description} Downloads ${download}.`);
  }
}

const { options, positional } = parseArgs(process.argv.slice(2));
const [command, ...rest] = positional;

switch (command) {
  case "serve":
    await commandServe(options);
    break;
  case "ask":
    await commandAsk(rest.join(" "), options);
    break;
  case "models":
    commandModels();
    break;
  default:
    console.log(USAGE);
    process.exit(command ? 2 : 0);
}
