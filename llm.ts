#!/usr/bin/env node
/**
 * llm CLI — simple text in, text out.
 *
 *   llm "your prompt"
 *   echo "your prompt" | llm
 *   llm -m puter/gpt-4o-mini "explain closures"
 *   llm --list
 *
 * No flags for structured output by design: these free keyless providers only
 * partially support it, so the CLI stays plain text.
 */
import { FreeModels } from "./index.ts";
import { listModels } from "./registry.ts";
import { DEFAULT_MODEL } from "./api.ts";
import type { ChatMessage } from "./types.ts";

const HELP = `llm — chat with free, keyless AI models (text in, text out)

Usage:
  llm [options] [prompt...]
  echo "prompt" | llm [options]

Options:
  -m, --model <id>     model id (default: ${DEFAULT_MODEL}); "auto", "auto/coding",
                       "provider/model", or a bare id
  -s, --system <text>  optional system prompt
      --key <p=token>  optional bearer token for provider p (repeatable)
      --no-stream      print the full reply at once instead of streaming
  -l, --list           list available models and exit
  -h, --help           show this help

Examples:
  llm "write a haiku about TypeScript"
  llm -m auto/coding "refactor this function"
  llm -m puter/gpt-4o-mini --key puter=$PUTER_TOKEN "explain monads"
  cat bug.txt | llm -s "You are a senior engineer" "diagnose this"`;

interface Parsed {
  model: string;
  system?: string;
  keys: Record<string, string>;
  stream: boolean;
  list: boolean;
  help: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { model: DEFAULT_MODEL, keys: {}, stream: true, list: false, help: false, prompt: "" };
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-m":
      case "--model":
        p.model = argv[++i] ?? p.model;
        break;
      case "-s":
      case "--system":
        p.system = argv[++i];
        break;
      case "--key": {
        const [prov, token] = (argv[++i] ?? "").split("=");
        if (prov && token) p.keys[prov] = token;
        break;
      }
      case "--no-stream":
        p.stream = false;
        break;
      case "-l":
      case "--list":
        p.list = true;
        break;
      case "-h":
      case "--help":
        p.help = true;
        break;
      default:
        words.push(a);
    }
  }
  p.prompt = words.join(" ");
  return p;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.list) {
    for (const m of listModels()) console.log(`${m.id}\t${m.name}`);
    return;
  }

  const prompt = opts.prompt || (await readStdin());
  if (!prompt) {
    console.error(HELP);
    process.exit(1);
  }

  const ai = new FreeModels({ keys: opts.keys });
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  try {
    if (opts.stream) {
      for await (const chunk of ai.stream({ model: opts.model, messages })) {
        process.stdout.write(chunk.choices?.[0]?.delta?.content ?? "");
      }
      process.stdout.write("\n");
    } else {
      const res = await ai.chat({ model: opts.model, messages });
      console.log(res.choices?.[0]?.message?.content ?? "");
    }
  } catch (err) {
    console.error(`\nerror: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
