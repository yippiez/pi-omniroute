/**
 * Registry — flat lookup over the keyless providers.
 *
 * This is the only "routing" in the library, and it is deliberately trivial:
 * map a model id to the provider(s) that serve it. There is no combo strategy,
 * weighting, circuit-breaker or cooldown (those lived in OmniRoute's separate
 * services layer and were intentionally dropped).
 */
import type { ProviderDef } from "./types.ts";
import { PROVIDERS } from "./providers/index.ts";

export { PROVIDERS };

export interface ModelEntry {
  /** Fully-qualified id: `provider/model`. */
  id: string;
  /** Bare upstream model id. */
  model: string;
  name: string;
  provider: string;
}

const byId = new Map<string, ProviderDef>();
for (const p of PROVIDERS) {
  byId.set(p.id, p);
  if (p.alias) byId.set(p.alias, p);
}

export function listProviders(): ProviderDef[] {
  return PROVIDERS;
}

export function getProvider(idOrAlias: string): ProviderDef | undefined {
  return byId.get(idOrAlias);
}

/** Every known free model as `provider/model` entries. */
export function listModels(): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const p of PROVIDERS) {
    for (const m of p.models) {
      out.push({ id: `${p.id}/${m.id}`, model: m.id, name: m.name, provider: p.id });
    }
  }
  return out;
}

export interface ResolvedModel {
  provider: ProviderDef;
  model: string;
}

/**
 * Resolve a model string to a provider + bare model id. Accepts:
 *   - "provider/model"  (explicit; also works for passthrough/unlisted models)
 *   - "alias/model"     (provider alias)
 *   - "model"           (bare; first provider that lists it wins)
 *
 * Returns every match so callers can fail over across providers that serve the
 * same model id.
 */
export function resolveModel(modelStr: string): ResolvedModel[] {
  if (!modelStr) return [];

  const slash = modelStr.indexOf("/");
  if (slash !== -1) {
    const prefix = modelStr.slice(0, slash);
    const rest = modelStr.slice(slash + 1);
    const provider = byId.get(prefix);
    if (provider) {
      // Explicit provider prefix — honour it even for passthrough/unlisted ids.
      const known = provider.models.some((m) => m.id === rest);
      if (known || provider.passthrough) {
        return [{ provider, model: rest }];
      }
    }
  }

  // Bare model id — collect every provider that lists it.
  const matches: ResolvedModel[] = [];
  for (const provider of PROVIDERS) {
    if (provider.models.some((m) => m.id === modelStr)) {
      matches.push({ provider, model: modelStr });
    }
  }
  return matches;
}
