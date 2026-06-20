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

// Non-streaming
const res = await ai.chat({
  model: "openai", // bare id, or "pollinations/openai", or "alias/model"
  messages: [{ role: "user", content: "Write a haiku about TypeScript." }],
});
console.log(res.choices[0].message.content);

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

## Model resolution

`resolveModel(modelStr)` accepts:

- `"provider/model"` — explicit (also works for unlisted ids on `passthrough` providers like Puter)
- `"alias/model"` — provider alias
- `"model"` — bare id; every provider that lists it is returned, so `chat()` can fail over between them

There is **no smart routing** beyond this lookup, by design.

## Develop

```bash
npm test         # node:test with a mocked fetch (no network)
npm run build    # emit dist/ via tsc
npm run typecheck
```

## License

MIT
