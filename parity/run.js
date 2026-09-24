// Put the same bytes to Jev and to Vej, and report what differs.
//
//   node parity/run.js
//
// Needs a TypeSafe key: `TYPESAFE_API_KEY`, or a `.env` beside this repo. Each
// run costs a handful of requests — a fraction of a cent — and takes about a
// minute, most of it Vej loading its models on the first call.

import { serve } from "../src/server.js";
import { CASES, MODELS_CASE } from "./cases.js";
import { differences, driftFromExpectation, precision } from "./compare.js";
import { get, JEV, LOCAL_KEY, post, requireApiKey } from "./service.js";

const key = requireApiKey();

const { server, url } = await serve({ port: 0, apiKey: LOCAL_KEY, web: false });
console.log(`Vej on ${url}, against ${JEV}\n`);

let matched = 0;
let drifted = 0;
const failures = [];
// How many decimal places each side uses anywhere, judged over the whole run.
const places = { jev: 0, vej: 0 };

for (const testCase of [...CASES, MODELS_CASE]) {
  const isGet = Boolean(testCase.path);
  // `auth` is the hosted key unless a case is specifically about a bad one.
  const jevAuth = testCase.auth === undefined ? `Bearer ${key}` : testCase.auth;
  const vejAuth = testCase.auth === undefined ? `Bearer ${LOCAL_KEY}` : testCase.auth;

  const jev = isGet ? await get(JEV, testCase.path, jevAuth) : await post(JEV, testCase.body, jevAuth);
  const vej = isGet ? await get(url, testCase.path, vejAuth) : await post(url, testCase.body, vejAuth);

  if (jev.status === 200) places.jev = Math.max(places.jev, precision(jev.body));
  if (vej.status === 200) places.vej = Math.max(places.vej, precision(vej.body));

  const drift = driftFromExpectation(testCase.expect, jev);
  const notes = isGet
    ? [
        jev.status !== vej.status ? `status ${vej.status}, Jev says ${jev.status}` : null,
        Object.keys(jev.body ?? {})[0] !== Object.keys(vej.body ?? {})[0]
          ? `keyed by \`${Object.keys(vej.body ?? {})[0]}\`, Jev uses \`${Object.keys(jev.body ?? {})[0]}\``
          : null,
      ].filter(Boolean)
    : differences(jev, vej);

  if (drift.length) drifted += 1;
  if (notes.length === 0) matched += 1;
  else failures.push({ name: testCase.name, notes });

  const mark = notes.length === 0 ? "  ok  " : "  --  ";
  console.log(`${mark}${testCase.name}`);
  for (const note of drift) console.log(`        Jev has moved: ${note}`);
  for (const note of notes) console.log(`        ${note}`);
}

server.closeAllConnections();
server.close();

const total = CASES.length + 1;
console.log(`\n${matched}/${total} match${drifted ? `, ${drifted} where Jev itself has moved since these were recorded` : ""}`);

console.log(`precision: Vej ${places.vej} decimals, Jev ${places.jev}`);
if (places.vej > places.jev) {
  console.log("  -- Vej is more precise than the API it copies, which is a difference a client can see");
  process.exitCode = 1;
}

if (failures.length) process.exitCode = 1;
