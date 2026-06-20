import { test } from "node:test";
import assert from "node:assert/strict";

import { FreeModels, listModels, resolveModel } from "../index.ts";
import { PROVIDERS } from "../providers/index.ts";

test("every provider is keyless or optional-key and OpenAI-shaped", () => {
  for (const p of PROVIDERS) {
    assert.ok(p.baseUrl.startsWith("https://"), `${p.id} has https baseUrl`);
    assert.ok(["none", "optional"].includes(p.auth), `${p.id} auth is keyless`);
    assert.ok(p.models.length > 0, `${p.id} lists models`);
  }
});

test("listModels yields provider/model entries", () => {
  const models = listModels();
  assert.ok(models.length >= 10);
  assert.ok(models.every((m) => m.id === `${m.provider}/${m.model}`));
  assert.ok(models.some((m) => m.provider === "pollinations"));
});

test("resolveModel: explicit provider prefix", () => {
  const r = resolveModel("pollinations/openai");
  assert.equal(r.length, 1);
  assert.equal(r[0].provider.id, "pollinations");
  assert.equal(r[0].model, "openai");
});

test("resolveModel: passthrough honours unlisted ids on explicit prefix", () => {
  const r = resolveModel("puter/some-unlisted-model-xyz");
  assert.equal(r.length, 1);
  assert.equal(r[0].provider.id, "puter");
});

test("resolveModel: bare id collects every serving provider", () => {
  const r = resolveModel("openai"); // a pollinations bare id
  assert.ok(r.some((m) => m.provider.id === "pollinations"));
});

test("chat() posts OpenAI-shaped body and returns the completion", async () => {
  const calls: Array<{ url: string; body: any; auth?: string }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: (init?.headers as Record<string, string>)?.["Authorization"],
    });
    return new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const ai = new FreeModels({ fetchImpl: fakeFetch, keys: { puter: "tok" } });
  const res = await ai.chat({ model: "pollinations/openai", messages: [{ role: "user", content: "ping" }] });

  assert.equal(res.choices[0].message.content, "pong");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gen.pollinations.ai/v1/chat/completions");
  assert.equal(calls[0].body.model, "openai");
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.jsonMode, true); // pollinations transformBody
});

test("chat() propagates the error when the only provider fails", async () => {
  const fakeFetch: typeof fetch = async () => new Response("boom", { status: 500 });
  const ai = new FreeModels({ fetchImpl: fakeFetch });
  await assert.rejects(
    () => ai.chat({ model: "pollinations/openai", messages: [{ role: "user", content: "x" }] }),
    /upstream HTTP 500/
  );
});

test("chat() fails over to the next provider that serves the same model", async () => {
  // Two synthetic providers serving one bare id. resolveModel's bare-id path
  // iterates the live PROVIDERS array, so pushing here exercises real fail-over.
  PROVIDERS.push(
    { id: "fo-a", label: "A", baseUrl: "https://a.invalid/v1", auth: "none", models: [{ id: "fo", name: "fo" }] },
    { id: "fo-b", label: "B", baseUrl: "https://b.invalid/v1", auth: "none", models: [{ id: "fo", name: "fo" }] }
  );
  try {
    const fakeFetch: typeof fetch = async (url) =>
      String(url).includes("a.invalid")
        ? new Response("down", { status: 503 })
        : new Response(
            JSON.stringify({
              choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
    const ai = new FreeModels({ fetchImpl: fakeFetch });
    const res = await ai.chat({ model: "fo", messages: [{ role: "user", content: "x" }] });
    assert.equal(res.choices[0].message.content, "ok");
  } finally {
    PROVIDERS.splice(-2, 2);
  }
});

test("puter bearer token is sent when configured", async () => {
  let seenAuth: string | undefined;
  const fakeFetch: typeof fetch = async (_url, init) => {
    seenAuth = (init?.headers as Record<string, string>)?.["Authorization"];
    return new Response(
      JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const ai = new FreeModels({ fetchImpl: fakeFetch, keys: { puter: "secret-token" } });
  await ai.chat({ model: "puter/gpt-4o-mini", messages: [{ role: "user", content: "x" }] });
  assert.equal(seenAuth, "Bearer secret-token");
});
