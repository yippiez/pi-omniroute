/**
 * api.ts — the simplest possible external entry point.
 *
 * One function: give it a prompt, get back text. No structured outputs, no
 * streaming, no provider juggling — those live in `index.ts` (`FreeModels`) for
 * callers who want them. This is the "just give me a string" door.
 *
 * @example
 * ```ts
 * import { ask } from "free-models/api";
 * const text = await ask("Write a haiku about TypeScript.");
 * const text2 = await ask("explain monads", { model: "puter/gpt-4o-mini" });
 * ```
 */
import { FreeModels } from "./index.ts";
import type { ChatMessage } from "./types.ts";

export interface AskOptions {
  /** Model id: `provider/model`, `alias/model`, or a bare id. Default "openai". */
  model?: string;
  /** Optional system prompt. */
  system?: string;
  /** Optional per-provider bearer tokens, keyed by provider id. */
  keys?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  /** Override the global fetch (for tests/proxies). */
  fetchImpl?: typeof fetch;
}

/** The default free model — Pollinations' keyless OpenAI gateway. */
export const DEFAULT_MODEL = "openai";

/** Send a prompt, get the assistant's reply as a plain string. */
export async function ask(prompt: string, opts: AskOptions = {}): Promise<string> {
  const ai = new FreeModels({ keys: opts.keys, fetchImpl: opts.fetchImpl });

  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const res = await ai.chat({
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  });

  return res.choices?.[0]?.message?.content ?? "";
}

export default ask;
