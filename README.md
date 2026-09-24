# Vej

A local [Jev](https://docs.typesafe.ai). Same three primitives, same request and
response shapes, same idea — a model that returns a calibrated judgment instead
of a paragraph — with the weights on the machine that asked. It runs in a
browser tab or as a Node server, from the same source, and answers three
questions in about 150 ms.

```js
import { noul, VejClient } from "vej";

const vej = new VejClient();

const { answers } = await vej.systemOne({
  state: "We drove the new route on Saturday. The trip took about an hour.",
  questions: { by_car: noul("The writer travelled by car.") },
});

answers.by_car.noul; // 0.99
```

## How it works

Vej is built on **NLI cross-encoders** — models trained to say whether a claim
follows from a text. That is already the shape of a judgment, so no prompting
is involved:

1. **State becomes a premise.** Text is used as written; structured state is
   laid out as prose.
2. **Each outcome becomes a claim** about that premise.
3. **One batched forward pass** returns, per claim, a distribution over
   *entailment* / *contradiction* / *neutral*.
4. **Arithmetic turns that into an answer** — the noul is one probability, the
   choice is the argmax with its distribution, the score is the
   probability-weighted position on its own number line, and confidence is
   concentration.

The model is never asked to write anything, so it cannot answer off the list.
Steps 1, 2 and 4 have no model in them, which is why the whole engine is tested
against fake runtimes: **36 tests, no weights, no network, no key.**

There is no decoder and no generation, which is where the speed comes from: the
members are 100–200M parameters and every claim in a request rides one pass.

### The two readings

Both primitives read the same three numbers, differently, and the difference
was measured rather than assumed.

A **noul** asks one claim and takes entailment over the whole label set,
reading `false` as the remainder. A state with nothing to do with the claim
lands in `neutral` and comes out a no. Split into a `true` and a `false`
hypothesis and scored two-way instead, "Thanks, that fixed it!" scores **0.92**
against a claim about escalation; read this way it scores **0.04**.

A **choice** or **score** asks one claim per outcome and reads the same number
for each, then normalizes across them.

This used to drop `neutral` and compare entailment against contradiction,
`e / (e + c)`, which was measured and was right for the single small MNLI model
it was measured on. It is wrong, and the way it is wrong is worth keeping in
mind: an option that nothing supports *and* nothing contradicts has e ≈ 0 and
c ≈ 0, so `e / (e + c)` ≈ 0.5. On a text about roadworks, the option "bad
weather held them up" scored:

```
entail 0.001   contradict 0.001   neutral 0.998
```

— and took **34%** of the answer. A coin flip for something the text never
mentioned. Entailment over the whole label set has no such hole: 0.001 stays
0.001, and weather drops to 0.1%.

The lesson generalizes past this one rule: **a decision justified against one
model has to be re-derived when the models change.** The case that originally
ruled out entailment-alone was a routing question the old model got backwards;
on the current ensemble it scores 100% correct.

A choice also cannot have position bias: the outcomes are never shown to the
model as a list for it to prefer the top of.

### Several models, routed per question

No single model measured here is good enough, and they fail on *disjoint*
cases. `zeroshot-base` is the only one that can place "about an hour" inside
"half an hour to two hours" — and the only one that collapses to 0.15 on a
claim the others answer at 1.00.

What makes combining them work is that the errors are one-sided. Over a suite
of claims, every member stays below 0.11 on claims that are false and misses
claims that are true: they **under-claim entailment, they do not invent it**.
So the member that found the most support is the one to believe.

| | false claims | "an hour is in 0.5–2h" | "travelled by car" |
| --- | --- | --- | --- |
| `nli-small` | ≤ 0.11 | 0.01 | 1.00 |
| `zeroshot-base` | ≤ 0.01 | 0.95 | 0.15 |
| **routed** | **≤ 0.11** | **0.95** | **1.00** |

That took the suite from 1/12 wrong to **0/12**, and mean absolute error from
0.11 to 0.03.

The routing is **per question, not per claim**, and that distinction is the
whole design. A choice's labels are compared against each other, so they must
come from one model on one scale. Picking the strongest opinion claim by claim
lets label A come from one model and label B from another, and the argmax
flips — measured, it took a routing test from 9/9, which both members score
alone, down to 6/9. Within a question the strongest member wins and its whole
distribution is used.

Averaging does not work, for the same reason max does: an average drags a
correct 0.95 down with a wrong 0.01. Measured mean absolute error was 0.19 for
the mean against 0.03 for routing.

## Three ways to run it

**In process.** `VejClient` has the shape `TypeSafeClient` has, so code written
against the SDK takes one without a change.

```js
const vej = new VejClient({ defaultModel: "vej-latest" });
```

**As a server.** `POST /v1/systemone` takes and returns exactly what the
TypeSafe API takes and returns, so an existing program moves over by changing
one environment variable. That is checked against the live API rather than
asserted — `node parity/run.js` puts the same bytes to both and compares the
status, the body shape, the error shape and the limits. It currently reports
**19/19**, and it needs a TypeSafe key.

Matching it meant copying some things that are not obvious, every one of them
found by asking the real service rather than reading the SDK's types:

| | |
| --- | --- |
| errors | everything under `detail` — a list for 422, an object or a bare sentence for 400 |
| no key vs wrong key | **403** and **401**, not both 401 |
| `state: null` | refused as a *missing field*, not accepted as a value |
| `model` | required on the wire, though the client fills it in for you |
| one choice label, one score level | **accepted**, though the SDK's types say two |
| `GET /v1/models` | keyed `models`, not `data` |
| probabilities | two decimal places |

```bash
npx vej serve
```

```bash
TYPESAFE_BASE_URL=http://localhost:8787 TYPESAFE_API_KEY=local node your-app.js
```

**In a browser.** The server also serves a playground at `/`, with State and
Questions editors, a model picker, `⌘↵` to run, and a shareable link in the
URL. The dropdown chooses where it runs: post to the server, or download the
model and run it in the tab on WebGPU. Same engine either way — the page
imports the same `src/` the server does, so there is no build step and no
second implementation to keep in sync.

## The primitives

| Question | Answers with | Use it when |
| --- | --- | --- |
| `noul(instructions, criteria?)` | `noul`, a probability from 0 to 1 | the answer is yes or no |
| `choice(instructions, criteria)` | `choice`, `probabilities`, `confidence` | one option out of a defined set |
| `score(instructions, criteria)` | `score`, `probabilities`, `legend`, `confidence` | a position on an ordered rubric |

`criteria` means what it means in the API: an optional `{ true, false }` for a
noul, a map of label to description for a choice, an ordered list of 2 to 10
level descriptions for a score. Score levels are indexed **from zero**, as they
are in Jev, so a three-level rubric scores 0 to 2.

```js
const { answers } = await vej.systemOne({
  state: { text, source: "a message to a friend" },
  questions: {
    by_car: noul("The writer travelled by car."),
    cause: choice("What slowed the journey down?", {
      roadworks: "Construction or roadworks held them up.",
      traffic: "Ordinary traffic held them up.",
      unstated: "The text does not say what slowed them down.",
    }),
    how_long: score("How long did the journey take?", [
      "The journey took less than half an hour.",
      "The journey took between half an hour and two hours.",
      "The journey took more than two hours.",
    ]),
  },
});
```

## Writing questions it can actually answer

This is the part that decides whether Vej is useful to you, and it is worth
more than any tuning knob. Four rules, each one learned the hard way and each
one measured.

### Send the state the question needs

Everything in `state` becomes the premise, and the model reads all of it, so an
irrelevant field is text the judgment has to see past.

How much that costs depends entirely on the model. On `nli-small` alone,
carrying one spare `source: "a message to a friend"` beside the text moved a
score's two contending levels from 34/60 to 24/75 — ten points for a field with
nothing to do with the question. On the default ensemble the same comparison is
50/50 against 49/51, which is nothing at all.

So: still worth doing, no longer worth worrying about, and a reminder that a
number measured against one model is a number about that model.

### Criteria are the hypotheses. Write them as sentences.

They become claims about your state. `"Charges, invoices, refunds"` is turned
into `"This is charges, invoices, refunds."` automatically, which works; a
sentence you wrote yourself works better. A vague label gives the model nothing
to judge.

### Ask what the text says, not how it says it

An NLI model decides whether a claim follows from a text. Claims *about* the
text — its tone, its register, how sure its author sounds — are not entailment
relations, and it answers them confidently and wrongly. On "We tried the new
route on Saturday and it took about forty minutes longer":

| Claim | Contradiction | Entailment |
| --- | --- | --- |
| The journey took much longer than usual. | 0.014 | **0.949** |
| The writer states it as plain fact. | **1.000** | 0.000 |
| The writer is describing something they did themselves. | **0.959** | 0.002 |

The first is right. The other two are certain and backwards, about a sentence
that begins "We tried". Nor does a bigger or different model rescue it: on
three texts whose register is unambiguous, a 6-layer cross-encoder and a 1.7B
causal LM both scored 2/3, and both failed the first-person question on all
three. Ask a different question.

### Score rubrics need absolute thresholds

"A little longer" and "much longer" ask for a comparison against a baseline,
and the model does not make it — not even when the baseline is in the state:

| State | Correct | Answer |
| --- | --- | --- |
| "forty minutes longer than the old one" | unanswerable | 1.46 |
| "the old one takes twenty minutes; this took an hour" | ~2 | 1.45 |
| "the old one takes nine hours; this took nine hours forty" | ~1 | 1.37 |

Flat. Name the thresholds in the levels instead — *under half an hour*, *half
an hour to two hours*, *over two hours* — and the same three texts rank
correctly at 0.49 / 1.00 / 1.50. Ordered, though compressed toward the middle:
trust the ranking, not the spacing.

### Keep one question on one axis

A score's levels should be mutually exclusive and on one dimension. Given "the
trip took about an hour… it was about 40 minutes longer", this rubric has two
levels that are *both* true and on different axes — a duration and a
comparison:

```
0  The journey took less than half an hour.
1  The journey took between half an hour and two hours.   <- true
2  The journey was longer than normal.                    <- also true
3  The journey took more than two hours.
```

The default answers **49% / 51%**, which is right. It is worth knowing how
narrowly: level 1 needs the step from "about an hour" to a numeric range, and
`nli-small` scores that claim at **0.01**, a 1.7B causal LM at 0.36, and
`zeroshot-base` at **0.95**. One model in the ensemble can read worded units
and the rest cannot. On a single model this rubric collapses to 32/62.

So a mixed-axis rubric is still a bad rubric — it only survives here because
the routing finds the member that can answer it. Split the axes when you can.

## Probability in words

A noul of 0.734 reads as more precise than any judgment is. The words people
use are coarser, and far more stable than you would expect: the median value
assigned to *probable* has been about 70% in every survey from the 1970s to
[2026](https://hails.info/writing/perception-of-probability/).

```js
import { phraseFor, probabilityFor } from "vej";

phraseFor(0.93);                             // "almost certainly"
answers.x.noul > probabilityFor("likely");   // says what 0.75 meant
```

Pass `words: true` on the request or the client and every noul and choice
carries a `phrase`:

```
by_car    99.8% — almost certainly true
cause     roadworks (almost certainly)
```

A **score does not get one**, on purpose. It is a position on a rubric, not a
probability: put a word on the score and it reads as though 1.51 were "about
even"; put it on the most likely level and it restates that level's own
percentage.

`asPercent` formats a probability so that it cannot lie at the ends —
`0.997` is `99.7%`, never `100%`. That is not fussiness. Rounding it up
produced an answer reading **"100% true"** beside **"0.3% false"**, which sum
to 100.3, carrying the phrase "almost certainly" next to a number claiming
certainty. Even an exact 1 prints `>99.9%`, because an exact 1 is an artifact
of rounding the distribution to six places.

| Phrase | 2026 (n=99) | 2015 (n=46) | NATO 1970s |
| --- | --- | --- | --- |
| almost certainly | 90% | 90% | 85% |
| likely | 75% | 70% | 75% |
| probable | 70% | 70% | 70% |
| we believe | 70% | 70% | 70% |
| about even | 50% | 50% | 50% |
| probably not | 20% | 30% | 20% |
| unlikely | 15% | 20% | 15% |

Two honest limits. This is a **reporting layer**: `phraseFor` is a monotone
lookup, so it cannot reorder anything, and a word on a wrong answer is still
wrong. And the scale stops at *almost certainly* — there is no published anchor
above 90%, so a saturated 1.00 is reported as "almost certainly" rather than as
certainty. Interquartile ranges in the survey span 10 to 20 points, which is
the real resolution of any of these numbers.

## What to expect from it

### How often it decides the same thing as Jev

`npm run agreement` puts 24 unambiguous questions to Vej and to the hosted Jev
and compares the **decision**, not the probability: which side of 0.5 a noul
falls on, which label a choice picks, which level a score rounds to. Comparing
0.88 against 0.95 tells you nothing you can act on; those three do.

| | same decision | |
| --- | --- | --- |
| **Choice** | **6 / 6** | every label identical |
| **Noul** | **9 / 12** | usually right, and wrong in ways you can read below |
| **Score** | **1 / 6** | does not track Jev's levels |
| **Overall** | **16 / 24 (67%)** | measured 2026-09-24, `vej-latest` |

**Use choice.** It was right on every case, including the one where the honest
answer was "none of these".

**Check nouls you depend on.** The three misses were: "the trip took more than
half an hour longer" over a state saying five minutes (Vej yes, Jev no); an
empty `catch` block, asked whether it swallows the error (**Vej no, Jev yes** —
Vej reads the code but not the absence); and "the event is going ahead" after
"if it rains we will cancel, the forecast is clear" (Vej no, Jev yes).

**Do not trust score.** One case in six, which for four-level rubrics is chance.
Worse than the count: it is sometimes *inverted*. Asked how serious a change
was for security, Vej put "any password is accepted for the admin account" at
level 1 and a reworded greeting at level 2 — Jev put them at 3 and 0. A score
here is a position on a ladder the model has not really understood. If you need
one, fit your own thresholds against your own labelled data and measure before
you rely on it.

None of this is a bug to be fixed by a patch. Vej runs different weights, and
`npm run agreement` is a measurement, not a test: it fails only if it could not
ask. Re-run it when you change models.

### Against Jev's own published numbers

Asked "Is the customer asking for a human agent?" over the six messages the
TypeSafe docs use as their own example, against the values those docs publish
for Jev:

| State | Jev | Vej |
| --- | --- | --- |
| Thanks, that fixed it! | 0.02 | 0.07 |
| How do I reset my password? | 0.07 | 0.66 |
| I need this sorted today, whatever it takes. | 0.26 | 0.02 |
| Are you a bot? | 0.40 | 0.08 |
| Is there any way to speak to someone about my invoice? | 0.84 | 0.83 |
| I have asked three times now. Can I please just talk to a real person? | 0.99 | 0.95 |
| **Rank correlation with Jev** | 1.00 | **0.71** |

The range (0.02–0.95) is close to Jev's and four of the six are close. It still
misreads *How do I reset my password?* badly, and **a threshold tuned against
Jev will not transfer.** Fit your own, on your own data.

Nouls are also brittle to phrasing. Over six claims all true of one sentence,
five scored 0.90–1.00 and one — "the new route was *slower* than the old
route", where the text says "took longer" — scored **0.37**. Phrase a claim the
way the text would, and check the ones you depend on.

## Models

Ensembles, which is what the default is:

| Name | Members | Download | Three questions |
| --- | --- | --- | --- |
| `vej-latest` | `nli-small` + `zeroshot-base` | 416 MB | ~150 ms — the default |
| `vej-small` | `nli-distil` + `zeroshot-xsmall` | 155 MB | ~60 ms |

And the members, usable on their own:

| Name | Repository | Download |
| --- | --- | --- |
| `zeroshot-base` | `MoritzLaurer/deberta-v3-base-zeroshot-v1.1-all-33` | 244 MB |
| `zeroshot-xsmall` | `MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33` | 87 MB |
| `nli-small` | `Xenova/nli-deberta-v3-small` | 172 MB |
| `nli-distil` | `Xenova/distilbert-base-uncased-mnli` | 68 MB |

How they compare, on the checks used throughout this README:

| | the mixed rubric | `by_car` | ladder rank-corr | routing | ms |
| --- | --- | --- | --- | --- | --- |
| `nli-small` | 32 / 62 | 100% | 0.71 | 9/9 | 41 |
| `zeroshot-base` | 49 / 51 | 48% | **0.83** | 9/9 | 80 |
| `vej-small` | 29 / 23 | 96% | **0.89** | 9/9 | **59** |
| **`vej-latest`** | **49 / 51** | **100%** | 0.71 | 9/9 | 121 |

`vej-small` ranks nouls best and is the fastest, but its scores are flat —
take it for a browser tab, not for rubrics. `vej-latest` is the only one that
gets both the rubric and `by_car` right.

Anything with a slash in it is passed through as a repository id, so any ONNX
sequence-classification model works. It needs an `entailment` label and either
a `contradiction` or a `not_entailment` label — both three-way NLI heads and
binary zero-shot heads work, and refusing the binary ones would have cost the
only model here that reads worded units. The runtime checks on load.
`vej models` prints the list.

## Options

```js
new VejClient({
  temperature: 1,           // divides the outcome log-odds; >1 softens, <1 sharpens
  words: false,             // attach a probability phrase to every answer
  defaultModel: "vej-latest",
  runtimeOptions: {
    device: "auto",         // webgpu in a browser, cpu in Node
    dtype: null,            // the model's own default
    maxLength: 512,
    batchSize: 32,          // claims per forward pass
    onProgress: null,       // download progress, for a loading bar
  },
});
```

`temperature` is a monotone transform of the log-odds: it widens or narrows the
spread and buys no discrimination. The same was true of contextual calibration,
which used to be an option here — it left rank correlation untouched, narrowed
the noul range, and cost a forward pass per question, so it was removed rather
than left lying around looking useful.

`plan()` prices a request before you run it, and prints the exact claims — the
first thing to look at when an answer surprises you:

```js
await vej.plan(request);
// { pairs: 8, forwardPasses: 1, premise: "...", questions: [{ hypotheses: [...] }] }
```

## The command line

```bash
vej serve --port 8787 --model vej-latest   # API and playground
vej ask "The text mentions a price." --state "It came to about forty pounds."
vej models
```

## Limits worth knowing

- **It is not Jev.** The shapes match; the numbers do not. Jev is trained to
  return a calibrated judgment. This is a general NLI model read carefully, and
  it gives you that with Jev's interface. It reaches the same decision as Jev
  on 67% of the cases in `npm run agreement` — 6/6 on choice, 9/12 on noul,
  **1/6 on score**.
- **Score is the weak primitive.** It does not track Jev's levels and is
  sometimes inverted. Prefer a choice over an ordered set of labels, or fit
  your own thresholds and measure them.
- **No tone, no style, no coreference guarantees.** See the rules above. Worded units work only because one ensemble member handles them; a single model mostly cannot.
- **Confidence is concentration, not correctness.** A confident wrong answer is
  a thing a model can produce.
- **A question can only be answered from the state.** If the state does not
  contain what the question needs, a spread-out answer is the correct one, and
  reading it as model error sends you optimizing the wrong thing.
- **The premise is everything the state contains.** A spare field is text the
  judgment reads past. It cost ten points on one model and nothing on the
  default — see above.

## Running it

```bash
npm install
```

```bash
npm test
```

```bash
npm run serve
```

`npm test` runs the engine, the ensemble routing, the decoding, the premise and
hypothesis rendering, the words scale and the HTTP layer against fake runtimes: no weights, no
network, no key. `npm run demo` loads a real model and does.
`node examples/drop-in.js` starts a server and talks to it over HTTP the way a
TypeSafe client would, using the mock, so it costs nothing.

Two more compare Vej against the real thing, and both need a TypeSafe key in
`TYPESAFE_API_KEY` or a `.env` beside the repo:

```bash
npm run parity       # the wire: status codes, body shapes, error shapes
```

```bash
npm run agreement    # the answers: how often the decision is the same
```

`parity` is a test and should be 19/19 — run it after touching `server.js`,
`errors.js` or `questions.js`. `agreement` is a measurement, not a test; it is
67% and the number that matters is which primitive it is 67% *of*. Each run
costs a handful of requests.

## License

MIT.
