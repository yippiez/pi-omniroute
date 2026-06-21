import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FreeModels, listModels, resolveModel } from "../index.ts";
import { ask } from "../api.ts";
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
  // Concrete models (everything but the virtual "auto" entries) are `provider/model`.
  const concrete = models.filter((m) => m.provider !== "auto");
  assert.ok(concrete.every((m) => m.id === `${m.provider}/${m.model}`));
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

test("auto: resolveModel expands AUTO_CHAIN into ordered targets", () => {
  const targets = resolveModel("auto");
  assert.ok(targets.length >= 4, "auto expands to several providers");
  // First target should be the head of the chain (pollinations/openai-fast).
  assert.equal(targets[0].provider.id, "pollinations");
  assert.equal(targets[0].model, "openai-fast");
  // Spans multiple providers.
  assert.ok(new Set(targets.map((t) => t.provider.id)).size >= 3);
});

test("auto: listModels surfaces the virtual auto entries first", () => {
  const models = listModels();
  assert.equal(models[0].id, "auto");
  assert.equal(models[1].id, "auto/coding");
  assert.equal(models[0].provider, "auto");
});

test("auto/coding: expands to a code-tuned chain across providers", () => {
  const targets = resolveModel("auto/coding");
  assert.ok(targets.length >= 3);
  // Head of the coding chain is pollinations/qwen-coder.
  assert.equal(targets[0].provider.id, "pollinations");
  assert.equal(targets[0].model, "qwen-coder");
  // Distinct from the general chain.
  const general = resolveModel("auto");
  assert.notEqual(targets[0].model, general[0].model);
});

test("auto: chat falls over down the chain until one provider responds", async () => {
  let n = 0;
  const fakeFetch: typeof fetch = async () => {
    n += 1;
    if (n < 3) return new Response("down", { status: 503 }); // first two fail
    return new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "third" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const ai = new FreeModels({ fetchImpl: fakeFetch });
  const res = await ai.chat({ model: "auto", messages: [{ role: "user", content: "x" }] });
  assert.equal(res.choices[0].message.content, "third");
  assert.equal(n, 3);
});

test("auto is the default when model is omitted", async () => {
  const urls: string[] = [];
  const fakeFetch: typeof fetch = async (url) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const ai = new FreeModels({ fetchImpl: fakeFetch });
  const res = await ai.chat({ messages: [{ role: "user", content: "x" }] });
  assert.equal(res.choices[0].message.content, "ok");
  // Defaulted to auto -> first chain entry is pollinations.
  assert.equal(urls[0], "https://gen.pollinations.ai/v1/chat/completions");
});

test("ask() returns the reply as a plain string", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "a haiku" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const text = await ask("write a haiku", { fetchImpl: fakeFetch });
  assert.equal(text, "a haiku");
});

test("llm CLI --list prints provider/model entries (no network)", () => {
  const cli = fileURLToPath(new URL("../llm.ts", import.meta.url));
  const out = execFileSync("node", ["--import", "tsx/esm", cli, "--list"], {
    encoding: "utf8",
  });
  assert.match(out, /^auto\b/m);
  assert.match(out, /^auto\/coding\b/m);
  assert.match(out, /pollinations\/openai/);
  assert.match(out, /puter\//);
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
