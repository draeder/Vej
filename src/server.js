// The Node server.
//
// `POST /v1/systemone` takes and returns exactly what the TypeSafe API takes
// and returns, so pointing an existing client at this server is a change of
// base URL and nothing else:
//
//   TYPESAFE_BASE_URL=http://localhost:8787 TYPESAFE_API_KEY=local node app.js
//
// It also serves the playground, so one command gives you both an API and a
// page to poke at it with.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Vej } from "./engine.js";
import { AuthError, UsageError, VejError } from "./errors.js";
import { ENSEMBLES, MODELS, modelCards } from "./models.js";
import { validateApiRequest } from "./questions.js";
import { createRuntime } from "./runtime/index.js";

const WEB_ROOT = resolve(fileURLToPath(new URL("../web", import.meta.url)));
// The playground imports the engine as source when it runs the model in the
// tab, so the same files the server runs are the files the browser runs.
const SRC_ROOT = resolve(fileURLToPath(new URL("../src", import.meta.url)));
const MAX_BODY = 4 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
};

/**
 * A refusal, in the hosted API's shape: everything under `detail`, and the
 * status code says whether it is a list, an object or a sentence.
 */
const fail = (response, status, detail, requestId) =>
  json(response, status, { detail }, requestId ? { "x-typesafe-request-id": requestId } : {});

/** `req_` and 32 hex characters, as the hosted API issues. */
const requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`;

/** Read a JSON body, refusing one that is too large to be a question. */
function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new UsageError("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new UsageError("Invalid request.", { type: "api_usage_error" }));
      }
    });
    request.on("error", reject);
  });
}

/** Serve one file from `web/` or `src/`, refusing anything that escapes them. */
async function serveStatic(pathname, response) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const [root, path] = relative.startsWith("/src/")
    ? [SRC_ROOT, relative.slice(4)]
    : [WEB_ROOT, relative === "/" || relative === "\\" ? "index.html" : relative];
  const file = join(root, path);
  if (!file.startsWith(root)) return fail(response, 403, "Outside the web root.");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
      // The model runs in this page's workers; these headers are what let
      // WebGPU and threaded WASM be used at all.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    createReadStream(file).pipe(response);
  } catch {
    fail(response, 404, `No route for ${pathname}.`);
  }
}

/**
 * Build the server.
 *
 * @param {object} [options]
 * @param {object} [options.engine] A `Vej` to answer with; one is built if absent.
 * @param {string} [options.apiKey] Require this bearer token. Unset means open.
 * @param {boolean} [options.web] Serve the playground. Default true.
 * @param {object} [options.engineOptions] Engine and runtime options when one is built.
 */
export function createVejServer({ engine, apiKey = null, web = true, engineOptions = {} } = {}) {
  const { runtime, ...rest } = engineOptions;
  const vej =
    engine ?? new Vej({ runtime: runtime ?? createRuntime(engineOptions.runtimeOptions), ...rest });
  let ready = null;

  /** Load on the first question that needs the model, once, not on boot. */
  const answer = async (method, body) => {
    ready ??= vej.load();
    await ready;
    return vej[method](body);
  };

  /** Names this server will answer to, plus any repository id. */
  const known = new Set([...Object.keys(ENSEMBLES), ...Object.keys(MODELS), "jev-latest", "vej-latest"]);
  const isKnownModel = (name) => typeof name === "string" && (name.includes("/") || known.has(name.toLowerCase()));

  const routes = {
    "GET /v1/models": () => ({ models: modelCards() }),
    "GET /v1/health": () => ({ status: "ok", model: vej.model, loaded: ready !== null }),
    "POST /v1/systemone": (body) => answer("systemOne", validateApiRequest(body, isKnownModel)),
    "POST /v1/plan": (body) => answer("plan", validateApiRequest(body, isKnownModel)),
  };

  const server = createServer(async (request, response) => {
    const id = requestId();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      return response.end();
    }

    // No key at all and a wrong key are different answers on the hosted API —
    // 403 and 401 — and a client may well branch on which.
    if (apiKey && url.pathname.startsWith("/v1/")) {
      const header = request.headers.authorization ?? "";
      if (!header.trim()) {
        throw_(response, new AuthError("Must supply an API key! Check your request and try again.", 403), id);
        return;
      }
      if (header.replace(/^Bearer\s+/i, "") !== apiKey) {
        const message = "Cannot authenticate with the server. Please check your API key and try again.";
        throw_(response, new AuthError(message, 401), id);
        return;
      }
    }

    try {
      const route = routes[`${request.method} ${url.pathname}`];
      if (route) {
        const body = request.method === "POST" ? await readJson(request) : null;
        const result = await route(body);
        return json(response, 200, result, { "x-typesafe-request-id": id });
      }

      if (web && request.method === "GET") return serveStatic(url.pathname, response);
      return fail(response, 404, `No route for ${request.method} ${url.pathname}.`, id);
    } catch (error) {
      return throw_(response, error, id);
    }
  });

  /** Send an error in the API's shape, logging the ones that are ours. */
  function throw_(response, error, id) {
    const status = error instanceof VejError ? (error.status ?? 500) : 500;
    const detail = error instanceof VejError ? error.detail : "Internal server error.";
    if (status >= 500) console.error(`[vej] ${id}`, error);
    return fail(response, status, detail, id);
  }

  return { server, vej };
}

/** Start a server and resolve once it is listening. */
export async function serve({ port = 8787, host = "127.0.0.1", ...options } = {}) {
  const { server, vej } = createVejServer(options);
  await new Promise((done) => server.listen(port, host, done));
  const address = server.address();
  return { server, vej, url: `http://${host}:${address.port}`, port: address.port };
}
