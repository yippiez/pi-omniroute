# free-models

A tiny TypeScript library that exposes a handful of **free, keyless** AI
providers as a **single OpenAI-compatible provider**. Point a coding agent at
one instance and it can call any free model below — no API keys, no signup, no
routing engine, no UI.

This was extracted from a larger AI-router codebase. Everything except the raw
"how to call a provider" code was removed: no DB, no combo/fallback strategies,
no circuit-breakers, no dashboard. What remains is a thin `fetch` client plus
one declaration file per provider.

## Install

```bash
npm install   # dev deps only (tsx + typescript); the library itself has zero runtime deps
```

Requires Node ≥ 18 (uses the global `fetch`).

## Usage

```ts
import { FreeModels } from "free-models";

const ai = new FreeModels();

// Non-streaming. Omit `model` (or pass "auto") to auto-route across providers.
const res = await ai.chat({
  messages: [{ role: "user", content: "Write a haiku about TypeScript." }],
});
console.log(res.choices[0].message.content);

// ...or pin a specific model: bare id, "pollinations/openai", or "alias/model".
await ai.chat({ model: "puter/gpt-4o-mini", messages: [/* … */] });

// Streaming
for await (const chunk of ai.stream({
  model: "puter/gpt-4o-mini",
  messages: [{ role: "user", content: "Stream me a sentence." }],
})) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}

// Convenience: stream → string
const text = await ai.complete({ model: "openai", messages: [/* … */] });

// Discover what's available
console.log(ai.listModels());   // [{ id: "pollinations/openai", provider, model, name }, …]
console.log(ai.listModelIds());
```

### One-liner API

For callers that just want a string, `free-models/api` exposes a single function:

```ts
import { ask } from "free-models/api";

const text = await ask("Write a haiku about TypeScript.");
const text2 = await ask("explain monads", { model: "puter/gpt-4o-mini", system: "Be terse" });
```

### CLI (`llm`)

Plain text in, text out (no structured-output flags — see note below):

```bash
llm "write a haiku about TypeScript"   # streams the reply (auto by default)
llm -m auto/coding "refactor this function"
echo "diagnose this stack trace" | llm -s "You are a senior engineer"
llm -m puter/gpt-4o-mini --key puter=$PUTER_TOKEN "explain closures"
llm --list                             # list available models
```

> **Structured outputs are intentionally not exposed.** These free keyless
> providers only *partially* support `response_format` / JSON-schema (works on
> Pollinations' `openai*` models, UncloseAI/vLLM and Puter's OpenAI models;
> unreliable elsewhere), so the CLI stays plain text. If you need it, pass
> `response_format` yourself via the library's `chat()` — it's forwarded as-is
> to providers that support it.

### Optional keys

Some providers work keyless but accept an optional bearer token for higher
limits (`auth: "optional"`). Pass them by provider id:

```ts
const ai = new FreeModels({ keys: { puter: process.env.PUTER_TOKEN } });
```

## Providers

| Provider | id / alias | Auth | Notes |
| --- | --- | --- | --- |
| Pollinations | `pollinations` / `pol` | none (optional key) | anonymous OpenAI-compatible gateway |
| Hack Club AI | `hackclub` / `hc` | none | free proxy, no signup |
| UncloseAI | `uncloseai` / `unc` | none | unturf Hermes endpoint |
| Puter AI | `puter` / `pu` | optional key | 500+ models behind one endpoint |

Add a provider by dropping a `providers/<id>.ts` that exports a `ProviderDef`
and listing it in `providers/index.ts`.

## `auto` model

`auto` is the default. It expands to an ordered chain of providers
(`AUTO_CHAIN` in `registry.ts`) and tries each until one responds — so a single
rate-limited or down provider transparently falls through to the next:

```ts
await ai.chat({ model: "auto", messages });   // or just omit `model`
await ask("hello");                            // ask() also defaults to auto
```

```bash
llm "hello"                 # auto by default
llm -m auto "hello"         # explicit general routing
llm -m auto/coding "hello"  # code-tuned routing
```

There are two virtual models (edit `AUTO_CHAINS` in `registry.ts` to re-prioritise):

- **`auto`** — `pollinations/openai-fast` → `pollinations/openai` →
  `uncloseai/Hermes-3` → `hackclub/llama-3.3-70b` → `puter/gpt-4o-mini`
- **`auto/coding`** — `pollinations/qwen-coder` →
  `hackclub/deepseek-coder-33b` → `uncloseai/qwen3.6:27b` →
  `puter/codestral` → `pollinations/deepseek`

## Model resolution

`resolveModel(modelStr)` accepts:

- `"auto"` / `"auto/coding"` — the virtual models above; expand to an `AUTO_CHAINS` list, tried in order
- `"provider/model"` — explicit (also works for unlisted ids on `passthrough` providers like Puter)
- `"alias/model"` — provider alias
- `"model"` — bare id; every provider that lists it is returned, so `chat()` can fail over between them

Beyond `auto` and this lookup there is **no smart routing** (no weighting,
circuit-breakers or cooldowns), by design.

## Develop

```bash
npm test         # node:test with a mocked fetch (no network)
npm run build    # emit dist/ via tsc
npm run typecheck
```

## License

MIT
