// Probability in words.
//
// A number like 0.73 reads as more precise than any judgment actually is. The
// words people use for probability are coarser and, it turns out, remarkably
// stable: the median value assigned to "probable" has been about 70% in every
// survey from the 1970s to 2026, across different populations.
//
// So this maps between the two. It is a reporting layer and a place to write
// thresholds in language rather than magic numbers. It does not change any
// judgment: `phraseFor` is a monotone lookup, so it cannot reorder anything,
// and putting a word on a wrong answer does not make it less wrong.
//
// Medians as published, in percent:
//
//   phrase            2026 (n=99)   2015 (n=46)   NATO 1970s
//   Almost certainly      90            90            85
//   Likely                75            70            75
//   Probable              70            70            70
//   We believe            70            70            70
//   About even            50            50            50
//   Probably not          20            30            20
//   Unlikely              15            20            15
//
// Source: https://hails.info/writing/perception-of-probability/

/**
 * The scale, lowest first.
 *
 * Seven anchors, because seven are what the survey publishes medians for.
 * "Impossible" and "certain" are deliberately absent: they were asked about,
 * but no median is published for them, and inventing one to round a model's
 * saturated 1.00 up to a word meaning "no doubt at all" is exactly the false
 * precision this module exists to avoid.
 */
export const SCALE = [
  { phrase: "unlikely", probability: 0.15 },
  { phrase: "probably not", probability: 0.2 },
  { phrase: "about even", probability: 0.5 },
  { phrase: "probable", probability: 0.7 },
  { phrase: "we believe", probability: 0.7 },
  { phrase: "likely", probability: 0.75 },
  { phrase: "almost certainly", probability: 0.9 },
];

/** The phrases people reach for, in order, without the synonyms. */
const LADDER = SCALE.filter(({ phrase }) => phrase !== "we believe");

const normalizePhrase = (phrase) => String(phrase).trim().toLowerCase();

/**
 * The median probability people assign to a phrase.
 *
 * Use it to write a threshold in language: `noul > probabilityFor("likely")`
 * says what 0.75 means and survives someone asking why it was 0.75.
 *
 * @throws {Error} The phrase is not one of the seven with a published median.
 */
export function probabilityFor(phrase) {
  const found = SCALE.find((entry) => entry.phrase === normalizePhrase(phrase));
  if (!found) {
    throw new Error(
      `No published median for "${phrase}". Known phrases: ${SCALE.map((e) => e.phrase).join(", ")}.`,
    );
  }
  return found.probability;
}

/**
 * The phrase whose median is nearest a probability.
 *
 * Values past the ends of the scale get its end phrases. A model that returns
 * 1.00 is reported as "almost certainly" rather than as certainty, which is
 * the honest reading: the scale has no anchor above 90%, and neither, on this
 * evidence, do people.
 */
export function phraseFor(probability) {
  let best = LADDER[0];
  let distance = Infinity;
  for (const entry of LADDER) {
    const gap = Math.abs(entry.probability - probability);
    if (gap < distance) {
      distance = gap;
      best = entry;
    }
  }
  return best.phrase;
}

/**
 * A probability as a percentage that does not lie at the ends.
 *
 * Rounding 0.997 to "100%" claims a certainty no model here reported, and it
 * showed: an answer read "100% true" beside "0.3% false" — which sum to 100.3
 * — and carried the phrase "almost certainly" next to a number saying
 * otherwise. Nothing prints 100% or 0%, including an exact 1, which is itself
 * an artifact of rounding the distribution to six places.
 */
export function asPercent(probability) {
  if (probability > 0.999) return ">99.9%";
  if (probability < 0.001) return "<0.1%";
  return `${(probability * 100).toFixed(1)}%`;
}

/**
 * How much of a judgment the words can carry.
 *
 * Interquartile ranges in the survey span 10 to 20 percentage points, so two
 * probabilities closer together than that are not distinguishable by anyone
 * reading the word. This is the resolution the scale supports, and it is why
 * a noul printed to four decimal places is theatre.
 */
export const RESOLUTION = 0.1;
