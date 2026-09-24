// Comparing two answers to the same request.
//
// Vej runs different weights from Jev and will never agree on a probability.
// What it has to agree on is everything around the number: the status code,
// the shape of the body, the keys of an answer, and the way a refusal is
// phrased. This file knows the difference, and has no I/O in it so it can be
// tested without a key.

/** The `detail` of an error, as one of the three shapes the API uses. */
export function detailKind(body) {
  const detail = body?.detail;
  if (detail === undefined) return "none";
  if (Array.isArray(detail)) return "list";
  if (detail && typeof detail === "object") return "object";
  return typeof detail === "string" ? "string" : "other";
}

const sortedKeys = (value) => Object.keys(value ?? {}).sort();

/** Every answer's keys, so two responses can be compared without their values. */
export const answerShape = (body) =>
  Object.fromEntries(Object.entries(body?.answers ?? {}).map(([name, answer]) => [name, sortedKeys(answer)]));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What differs between the hosted response and Vej's, as a list of sentences.
 *
 * An empty list is parity. Values are never compared — only the contract
 * around them.
 */
export function differences(jev, vej) {
  const notes = [];

  if (jev.status !== vej.status) notes.push(`status ${vej.status}, Jev says ${jev.status}`);

  const jevKind = detailKind(jev.body);
  const vejKind = detailKind(vej.body);
  if (jev.status >= 400 && jevKind !== vejKind) {
    notes.push(`error detail is ${vejKind}, Jev sends ${jevKind}`);
  }
  if (jev.status >= 400 && "error" in (vej.body ?? {})) {
    notes.push("error body uses `error`, Jev uses `detail`");
  }

  if (jev.status === 200 && vej.status === 200) {
    const [jevShape, vejShape] = [answerShape(jev.body), answerShape(vej.body)];
    if (!same(jevShape, vejShape)) {
      notes.push(`answer keys ${JSON.stringify(vejShape)} against ${JSON.stringify(jevShape)}`);
    }
    if (!same(sortedKeys(jev.body), sortedKeys(vej.body))) {
      notes.push(`top-level keys ${sortedKeys(vej.body)} against ${sortedKeys(jev.body)}`);
    }
    const usage = sortedKeys(vej.body?.usage);
    if (!same(sortedKeys(jev.body?.usage), usage)) notes.push(`usage keys ${usage}`);
  }

  return notes;
}

/** Every number in a body, with the path that reached it. */
function numbers(value, path = "", out = []) {
  if (typeof value === "number") out.push([path, value]);
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) numbers(nested, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const decimals = (n) => (Number.isInteger(n) ? 0 : String(n).split(".")[1]?.length ?? 0);

/**
 * The most decimal places any probability in a body carries.
 *
 * Judged across a whole run, never within one response. A single answer tells
 * you nothing: Jev returning `1.0` where Vej returns `0.97` is two responses
 * agreeing on a two-decimal contract, and comparing them pairwise reports a
 * difference that is not there. Token counts are integers and excluded.
 */
export function precision(body) {
  const skip = /(^|\.)usage\./;
  return Math.max(0, ...numbers(body, "").filter(([path]) => !skip.test(path)).map(([, n]) => decimals(n)));
}

/** Did the hosted API do what the case recorded? Catches Jev itself moving. */
export function driftFromExpectation(expect, jev) {
  const notes = [];
  if (expect.status !== jev.status) notes.push(`recorded ${expect.status}, Jev now answers ${jev.status}`);
  if (expect.detail && detailKind(jev.body) !== expect.detail) {
    notes.push(`recorded a ${expect.detail} detail, Jev now sends ${detailKind(jev.body)}`);
  }
  if (expect.answerKeys) {
    const shape = answerShape(jev.body);
    for (const [name, keys] of Object.entries(expect.answerKeys)) {
      if (!same(keys, shape[name])) notes.push(`recorded ${name} as ${keys}, Jev now sends ${shape[name]}`);
    }
  }
  return notes;
}
