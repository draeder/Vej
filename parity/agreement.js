// Do Vej and Jev reach the same decision on the same question?
//
//   node parity/agreement.js [model]
//
// `run.js` compares the wire: status codes, body shapes, error shapes. It
// deliberately never looks at the numbers, because two different models will
// never produce the same ones. This looks at nothing else.
//
// The measure is not how close the probabilities are — comparing 0.88 to 0.95
// tells you nothing you can act on. It is what a program consuming the answer
// would actually do differently: which side of 0.5 a noul falls on, which
// label a choice picks, which level a score rounds to. Those are the three
// decisions the API exists to make.
//
// Needs a TypeSafe key, same as `run.js`. Each run is a few dozen requests.

import { serve } from "../src/server.js";
import { AGREEMENT_CASES } from "./answers.js";
import { JEV, LOCAL_KEY, post, requireApiKey } from "./service.js";

const key = requireApiKey();
const model = process.argv[2] ?? "vej-latest";

const { server, url } = await serve({ port: 0, apiKey: LOCAL_KEY, model, web: false });
console.log(`Vej (${model}) on ${url}, against ${JEV}\n`);

/**
 * Did the two land on the same decision?
 *
 * A noul is a yes/no, so the decision is the side of 0.5. A choice is the
 * label. A score is the level it rounds to, which is what indexing a rubric
 * with it gives you — a Vej of 0.88 and a Jev of 2.98 are levels 1 and 3, and
 * that is two different rungs of the ladder, not a rounding difference.
 */
const decisions = {
  noul: (answer) => (answer.noul >= 0.5 ? "yes" : "no"),
  choice: (answer) => answer.choice,
  score: (answer) => `level ${Math.round(answer.score)}`,
};

const rows = [];
for (const { kind, name, state, questions } of AGREEMENT_CASES) {
  const [vej, jev] = await Promise.all([
    post(url, { state, model, questions }, `Bearer ${LOCAL_KEY}`),
    post(JEV, { state, model: "jev-latest", questions }, `Bearer ${key}`),
  ]);

  if (vej.status !== 200 || jev.status !== 200) {
    rows.push({ kind, name, error: `Vej ${vej.status}, Jev ${jev.status}` });
    continue;
  }

  const read = decisions[kind];
  const ours = read(Object.values(vej.body.answers)[0]);
  const theirs = read(Object.values(jev.body.answers)[0]);
  rows.push({ kind, name, ours, theirs, agreed: ours === theirs });
}

server.closeAllConnections();
server.close();

const answered = rows.filter((row) => !row.error);
for (const kind of Object.keys(decisions)) {
  const set = answered.filter((row) => row.kind === kind);
  if (!set.length) continue;
  const agreed = set.filter((row) => row.agreed);
  console.log(`${kind.toUpperCase()}  ${agreed.length}/${set.length}`);
  for (const row of set) {
    const mark = row.agreed ? "  ok  " : "  --  ";
    console.log(`${mark}${row.name.padEnd(40)} Vej ${String(row.ours).padEnd(12)} Jev ${row.theirs}`);
  }
  console.log("");
}

for (const row of rows.filter((r) => r.error)) console.log(`  !!  ${row.name}: ${row.error}`);

const agreed = answered.filter((row) => row.agreed).length;
const percent = answered.length ? Math.round((agreed / answered.length) * 100) : 0;
console.log(`${agreed}/${answered.length} same decision (${percent}%)`);
console.log("\nThis is a measurement, not a test: Vej runs different weights and is");
console.log("expected to disagree. It fails only if it could not ask.");

if (rows.some((row) => row.error)) process.exitCode = 1;
