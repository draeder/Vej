// Reaching the two services.
//
// Shared by `run.js`, which compares the wire, and `agreement.js`, which
// compares the answers. Both need the same key from the same places and the
// same two verbs, and a second copy of the key lookup is a second thing to get
// wrong when someone moves their `.env`.

import { readFileSync } from "node:fs";

export const JEV = "https://api.typesafe.ai";

/** Vej needs a key to be present, not to be anything in particular. */
export const LOCAL_KEY = "parity";

/** The key, from the environment or any of the usual dotenv files. */
export function apiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const files = [
    new URL("../.env", import.meta.url),
    new URL("../../jevex/.env", import.meta.url),
    `${process.env.HOME}/.config/slopgateway/.env`,
  ];
  for (const file of files) {
    try {
      const found = readFileSync(file, "utf8").match(/^TYPESAFE_API_KEY\s*=\s*['"]?([^'"\n]+)/m);
      if (found) return found[1].trim();
    } catch {
      // A missing dotenv is the normal case, not a failure.
    }
  }
  return null;
}

/** The key, or a message and a non-zero exit. Both entry points want this. */
export function requireApiKey() {
  const key = apiKey();
  if (key) return key;
  console.error("No TYPESAFE_API_KEY. Put it in the environment or in a .env beside the repo.");
  process.exit(2);
}

export const post = async (base, body, auth) => {
  const headers = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  try {
    const response = await fetch(`${base}/v1/systemone`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, body: null, error: error.message };
  }
};

export const get = async (base, path, auth) => {
  try {
    const response = await fetch(`${base}${path}`, { headers: auth ? { authorization: auth } : {} });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, body: null, error: error.message };
  }
};
