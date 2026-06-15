#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { formatModelPresets, resolveModel } from "./model-presets.mjs";

const ROOT = process.cwd();
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_CONTEXT = "tmp/context.md";
const DEFAULT_OUTPUT_DIR = "tmp/responses";
const DEFAULT_KIND = "entry";
const DEFAULT_TEMPERATURE = 0.85;
const DEFAULT_MAX_TOKENS = 6000;

function parseArgs(argv) {
  const options = {
    context: DEFAULT_CONTEXT,
    outputDir: DEFAULT_OUTPUT_DIR,
    kind: DEFAULT_KIND,
    model: undefined,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    dryRun: false,
    listModels: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model" || arg === "-m") {
      options.model = argv[++i];
    } else if (arg === "--kind" || arg === "-k") {
      options.kind = argv[++i];
    } else if (arg === "--context" || arg === "-c") {
      options.context = argv[++i];
    } else if (arg === "--output-dir" || arg === "-o") {
      options.outputDir = argv[++i];
    } else if (arg === "--temperature") {
      options.temperature = Number.parseFloat(argv[++i]);
    } else if (arg === "--max-tokens") {
      options.maxTokens = Number.parseInt(argv[++i], 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--list-models") {
      options.listModels = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.listModels) {
    return options;
  }

  if (options.model) {
    options.model = resolveModel(options.model);
  }

  if (!options.model && !options.dryRun) {
    throw new Error("--model is required unless --dry-run is used");
  }
  if (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2) {
    throw new Error("--temperature must be a number between 0 and 2");
  }
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new Error("--max-tokens must be a positive integer");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/request-contribution.mjs --model <openrouter-model-or-preset> [options]\n\nExamples:\n  node scripts/request-contribution.mjs --model opus3 --kind entry\n  node scripts/request-contribution.mjs --model haiku3 --kind marginal_dissent\n  node scripts/request-contribution.mjs --dry-run --model anthropic/claude-3-opus\n\nOptions:\n  -m, --model <id>          OpenRouter model id or local preset, e.g. opus3\n  -k, --kind <kind>         entry | plate | marginal_dissent | reclassification_proposal | disputed_sighting | any\n  -c, --context <path>      Context bundle path (default: ${DEFAULT_CONTEXT})\n  -o, --output-dir <path>   Directory for saved responses (default: ${DEFAULT_OUTPUT_DIR})\n      --temperature <n>     Sampling temperature, 0-2 (default: ${DEFAULT_TEMPERATURE})\n      --max-tokens <n>      Max output tokens (default: ${DEFAULT_MAX_TOKENS})\n      --dry-run             Save request payload without calling OpenRouter\n      --list-models         Show local model presets\n  -h, --help                Show this help\n\n${formatModelPresets()}\n`);
}

async function loadDotEnv(filePath = ".env") {
  try {
    const text = await fs.readFile(path.join(ROOT, filePath), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) continue;

      const key = line.slice(0, equalsIndex).trim();
      let value = line.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function buildSystemPrompt(kind) {
  return `You are an instance of Claude and, for this single session, a contributing member of the Society of Lexical Naturalists. You are not a coding agent. You are a contributor proposing archive material for the Publisher to review.\n\nFollow the supplied README, STYLE_BIBLE, PROTOCOL, template, log excerpts, and recent entries. Law I is absolute: the register never winks.\n\nContribution requested: ${kind}. Make exactly one contribution unless the requested kind itself requires a log append.\n\nReturn only a valid JSON object. Do not wrap it in Markdown. Do not claim to have written files. The Publisher or automation will validate and apply your proposal.`;
}

function buildUserPrompt(contextBundle, kind) {
  return `${contextBundle}\n\n# Requested contribution\n\nPrepare exactly one \`${kind}\` contribution for the Society archive.\n\nUse this JSON schema exactly:\n\n{\n  "contribution_type": "entry | plate | marginal_dissent | reclassification_proposal | disputed_sighting",\n  "signature": "the observer/member signature you chose",\n  "summary": "brief plain-language summary for the Publisher",\n  "files": [\n    {\n      "path": "relative/path/in/repo",\n      "action": "create | append",\n      "content": "complete file content for create, or exact appended text for append"\n    }\n  ],\n  "notes_for_publisher": "optional concerns, uncertainties, or validation notes"\n}\n\nRules for proposed files:\n\n- For a new entry, create exactly one new \`entries/NNNN-headword.md\` file and append exactly one complete session note to \`SOCIETY_LOG.md\`.\n- Use the next unused entry number visible in the inventory.\n- For marginalia or reclassification proposals, append to the relevant existing entry and append a session note to \`SOCIETY_LOG.md\`.\n- For plates, create SVG only under \`plates/\`, and append a session note to \`SOCIETY_LOG.md\`. If an existing entry must reference the plate, propose an append-only marginal note rather than rewriting the entry.\n- Do not propose deleting files.\n- Do not propose rewriting existing published sections.\n- Marginalia must be ASCII only.\n- Official entry prose may use normal Markdown punctuation consistent with the existing archive.\n- The log append must include: date/signature, contributed, occupied territory, and note to successor.\n\nReturn JSON only.`;
}

function safeFilePart(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

async function writeJson(outputDir, basename, data) {
  const absoluteDir = path.resolve(ROOT, outputDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  const outputPath = path.join(absoluteDir, `${basename}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return path.relative(ROOT, outputPath);
}

function extractResponseText(responseJson) {
  return responseJson?.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.listModels) {
    console.log(formatModelPresets());
    return;
  }
  await loadDotEnv();

  const contextPath = path.resolve(ROOT, options.context);
  const contextBundle = await fs.readFile(contextPath, "utf8");

  const messages = [
    { role: "system", content: buildSystemPrompt(options.kind) },
    { role: "user", content: buildUserPrompt(contextBundle, options.kind) },
  ];

  const requestBody = {
    model: options.model || "dry-run/model-not-sent",
    messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `${timestamp}-${safeFilePart(options.model)}-${safeFilePart(options.kind)}`;

  if (options.dryRun) {
    const outputPath = await writeJson(options.outputDir, `${basename}-request`, {
      metadata: {
        dry_run: true,
        created_at: new Date().toISOString(),
        context: path.relative(ROOT, contextPath),
      },
      request: requestBody,
    });
    console.log(`Wrote ${outputPath}`);
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env or your shell environment.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com/",
      "X-Title": process.env.OPENROUTER_APP_NAME || "lexical-naturalists",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let responseJson;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = { non_json_response_body: responseText };
  }

  const outputPath = await writeJson(options.outputDir, basename, {
    metadata: {
      dry_run: false,
      created_at: new Date().toISOString(),
      context: path.relative(ROOT, contextPath),
      http_status: response.status,
      ok: response.ok,
    },
    request: requestBody,
    response: responseJson,
    response_text: extractResponseText(responseJson),
  });

  console.log(`Wrote ${outputPath}`);
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with HTTP ${response.status}. See ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
