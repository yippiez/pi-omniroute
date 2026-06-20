/**
 * free-models — a tiny library that exposes a handful of free, keyless AI
 * providers as a single OpenAI-compatible provider.
 *
 * Point a coding agent at one `FreeModels` instance and it can call any free
 * model below, with optional automatic fail-over across providers that serve
 * the same model id.
 *
 * @example
 * ```ts
 * import { FreeModels } from "free-models";
 * const ai = new FreeModels();
 * const res = await ai.chat({ model: "openai", messages: [{ role: "user", content: "hi" }] });
 * console.log(res.choices[0].message.content);
 *
 * for await (const chunk of ai.stream({ model: "openai", messages: [...] })) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 * }
 * ```
 */
import { chatCompletion, chatStream, ProviderHttpError, streamToText } from "./client.ts";
import { listModels, listProviders, resolveModel } from "./registry.ts";
import type { CallOptions } from "./client.ts";
import type { ChatChunk, ChatCompletion, ChatParams, ModelDef } from "./types.ts";
import type { ModelEntry } from "./registry.ts";

export * from "./types.ts";
export {
  chatCompletion,
  chatStream,
  streamToText,
  ProviderHttpError,
  listModels,
  listProviders,
  resolveModel,
};
export { PROVIDERS } from "./providers/index.ts";
export { ask, DEFAULT_MODEL } from "./api.ts";
export type { AskOptions } from "./api.ts";
export type { CallOptions } from "./client.ts";
export type { ModelEntry, ResolvedModel } from "./registry.ts";

export interface FreeModelsOptions {
  /** Optional per-provider bearer tokens, keyed by provider id (e.g. `{ puter: "..." }`). */
  keys?: Record<string, string>;
  /** Override the global fetch (for tests / proxies). */
  fetchImpl?: typeof fetch;
  /** Default request timeout in ms. */
  timeoutMs?: number;
}

export interface ChatRequest extends ChatParams {
  /** Model id: `provider/model`, `alias/model`, or a bare model id. */
  model: string;
  /**
   * When more than one provider serves the model, try each in order until one
   * succeeds. Default true.
   */
  fallback?: boolean;
}

export class NoProviderError extends Error {
  constructor(model: string) {
    super(`No free provider serves model "${model}". Try listModels() to see what's available.`);
    this.name = "NoProviderError";
  }
}

export class FreeModels {
  constructor(private opts: FreeModelsOptions = {}) {}

  /** All free models as `provider/model` entries. */
  listModels(): ModelEntry[] {
    return listModels();
  }

  /** Bare model ids only (deduped) — convenient for an agent's model picker. */
  listModelIds(): string[] {
    return [...new Set(listModels().map((m) => m.id))];
  }

  listProviders() {
    return listProviders();
  }

  private callOpts(providerId: string): CallOptions {
    return {
      apiKey: this.opts.keys?.[providerId],
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
    };
  }

  /** Non-streaming chat completion, with optional cross-provider fail-over. */
  async chat(req: ChatRequest): Promise<ChatCompletion> {
    const { model, fallback = true, ...params } = req;
    const targets = resolveModel(model);
    if (targets.length === 0) throw new NoProviderError(model);

    let lastErr: unknown;
    for (const { provider, model: m } of fallback ? targets : targets.slice(0, 1)) {
      try {
        return await chatCompletion(provider, m, params, this.callOpts(provider.id));
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Streaming chat completion. Fail-over only applies to the *connection*: once
   * the first chunk is yielded we are committed to that provider.
   */
  async *stream(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const { model, fallback = true, ...params } = req;
    const targets = resolveModel(model);
    if (targets.length === 0) throw new NoProviderError(model);

    let lastErr: unknown;
    for (const { provider, model: m } of fallback ? targets : targets.slice(0, 1)) {
      try {
        const gen = chatStream(provider, m, params, this.callOpts(provider.id));
        // Probe the first chunk so a connection failure falls through to the
        // next provider instead of surfacing mid-stream.
        const first = await gen.next();
        if (first.done) return;
        yield first.value;
        yield* gen;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** Convenience: stream and return the concatenated assistant text. */
  async complete(req: ChatRequest): Promise<string> {
    return streamToText(this.stream(req));
  }
}

/** A ready-to-use default instance (no keys configured). */
export const freeModels = new FreeModels();

export type { ChatCompletion, ChatChunk, ChatParams, ModelDef };
