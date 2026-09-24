// Wire compatibility, demonstrated against a mock so it costs nothing.
//
//   node examples/drop-in.js
//
// This starts a Vej server and talks to it with the request and headers a
// TypeSafe client sends, then prints what came back. Nothing here knows it is
// not talking to api.typesafe.ai — which is the point: to use a real client,
// set TYPESAFE_BASE_URL to the server's address and leave the code alone.

import { Vej } from "../src/index.js";
import { createMockRuntime } from "../src/runtime/mock.js";
import { serve } from "../src/server.js";

const useRealModel = process.argv.includes("--real");

const { url, server } = await serve({
  port: 0,
  apiKey: "local",
  engine: useRealModel ? undefined : new Vej({ runtime: createMockRuntime() }),
});

console.log(`vej at ${url}${useRealModel ? "" : " (mock runtime — pass --real to load the model)"}\n`);

try {
  const response = await fetch(`${url}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer local" },
    body: JSON.stringify({
      state: "I was charged twice for the same order and nobody has replied.",
      model: "jev-latest",
      questions: {
        billing: { type: "noul", instructions: "Is this about billing?" },
        urgency: {
          type: "score",
          instructions: "How urgently does this need a reply?",
          criteria: ["Whenever", "This week", "Today"],
        },
      },
    }),
  });

  console.log(`HTTP ${response.status}  request id ${response.headers.get("x-typesafe-request-id")}`);
  console.log(JSON.stringify(await response.json(), null, 2));
  // An error body has the same shape a TypeSafe error body has, so a client's
  // existing handling of it already works. Exit non-zero so a script notices.
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Could not reach ${url}: ${error.message}`);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
