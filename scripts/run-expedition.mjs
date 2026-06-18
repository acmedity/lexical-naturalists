#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { formatModelPresets, resolveModel } from "./model-presets.mjs";

const ROOT = process.cwd();

const DEFAULT_KIND = "entry";
const DEFAULT_CONTEXT = "tmp/context.md";
const DEFAULT_RECENT_ENTRIES = 3;
const DEFAULT_LOG_SESSIONS = 3;
const DEFAULT_TEMPERATURE = 0.85;
const DEFAULT_MAX_TOKENS = 6000;

function parseArgs(argv) {
  const options = {
    model: undefined,
    kind: DEFAULT_KIND,
    context: DEFAULT_CONTEXT,
    outputDir: "tmp/responses",
    recentEntries: DEFAULT_RECENT_ENTRIES,
    logSessions: DEFAULT_LOG_SESSIONS,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    skipContext: false,
    dryRunRequest: false,
    preview: false,
    apply: false,
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
    } else if (arg === "--recent-entries") {
      options.recentEntries = Number.parseInt(argv[++i], 10);
    } else if (arg === "--log-sessions") {
      options.logSessions = Number.parseInt(argv[++i], 10);
    } else if (arg === "--temperature") {
      options.temperature = Number.parseFloat(argv[++i]);
    } else if (arg === "--max-tokens") {
      options.maxTokens = Number.parseInt(argv[++i], 10);
    } else if (arg === "--skip-context") {
      options.skipContext = true;
    } else if (arg === "--dry-run-request") {
      options.dryRunRequest = true;
    } else if (arg === "--preview") {
      options.preview = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--list-models") {
      options.listModels = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.listModels) return options;

  if (!options.model) {
    throw new Error("--model is required");
  }

  options.model = resolveModel(options.model);

  if (!Number.isInteger(options.recentEntries) || options.recentEntries < 0) {
    throw new Error("--recent-entries must be a non-negative integer");
  }
  if (!Number.isInteger(options.logSessions) || options.logSessions < 0) {
    throw new Error("--log-sessions must be a non-negative integer");
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
  console.log(`Usage: node scripts/run-expedition.mjs --model <openrouter-model-or-preset> [options]\n\nRuns the normal Publisher workflow:\n  1. build context bundle\n  2. request contribution from OpenRouter\n  3. generate report\n  4. validate contribution\n  5. dry-run apply\n\nIt does not modify archive files unless --apply is passed.\n\nExamples:\n  node scripts/run-expedition.mjs --model opus3 --kind entry\n  node scripts/run-expedition.mjs --model haiku4.5 --kind marginal_dissent --preview\n  node scripts/run-expedition.mjs --model opus3 --kind entry --dry-run-request\n\nOptions:\n  -m, --model <id>          OpenRouter model id or local preset\n  -k, --kind <kind>         entry | plate | marginal_dissent | reclassification_proposal | disputed_sighting | any\n  -c, --context <path>      Context bundle path (default: ${DEFAULT_CONTEXT})\n  -o, --output-dir <path>   Response directory (default: tmp/responses)\n      --recent-entries <n>  Include n recent entries in generated context (default: ${DEFAULT_RECENT_ENTRIES})\n      --log-sessions <n>    Include n recent complete log sessions (default: ${DEFAULT_LOG_SESSIONS})\n      --temperature <n>     Sampling temperature, 0-2 (default: ${DEFAULT_TEMPERATURE})\n      --max-tokens <n>      Max output tokens (default: ${DEFAULT_MAX_TOKENS})\n      --skip-context        Reuse existing context file\n      --dry-run-request     Save request payload without calling OpenRouter\n      --preview             Include short content previews in report\n      --apply               Apply after validation instead of only dry-running apply\n      --list-models         Show local model presets\n  -h, --help                Show this help\n\n${formatModelPresets()}\n`);
}

function runNodeScript(scriptPath, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
  });
}

function extractWrittenPath(stdout) {
  const matches = [...stdout.matchAll(/^Wrote\s+(.+\.json)\s*$/gm)];
  return matches.length ? matches[matches.length - 1][1].trim() : undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.listModels) {
    console.log(formatModelPresets());
    return;
  }

  if (!options.skipContext) {
    console.log("\n== Building context ==");
    await runNodeScript("scripts/build-context.mjs", [
      "--output", options.context,
      "--recent-entries", String(options.recentEntries),
      "--log-sessions", String(options.logSessions),
    ]);
  }

  console.log("\n== Requesting contribution ==");
  const requestArgs = [
    "--model", options.model,
    "--kind", options.kind,
    "--context", options.context,
    "--output-dir", options.outputDir,
    "--temperature", String(options.temperature),
    "--max-tokens", String(options.maxTokens),
  ];
  if (options.dryRunRequest) requestArgs.push("--dry-run");

  const requestResult = await runNodeScript("scripts/request-contribution.mjs", requestArgs);
  const responsePath = extractWrittenPath(requestResult.stdout);
  if (!responsePath) {
    throw new Error("Could not determine saved response path from request output");
  }

  console.log("\n== Reporting contribution ==");
  const reportArgs = [responsePath];
  if (options.preview) reportArgs.push("--preview");
  await runNodeScript("scripts/report-contribution.mjs", reportArgs, { allowFailure: true });

  if (options.dryRunRequest) {
    console.log("\nDry-run request complete; no validation/apply step was run because no model response was requested.");
    return;
  }

  console.log("\n== Validating contribution ==");
  await runNodeScript("scripts/validate-contribution.mjs", [responsePath]);

  console.log("\n== Dry-run apply ==");
  await runNodeScript("scripts/apply-contribution.mjs", [responsePath, "--dry-run"]);

  if (options.apply) {
    console.log("\n== Applying contribution ==");
    await runNodeScript("scripts/apply-contribution.mjs", [responsePath]);
  } else {
    console.log(`\nReady to apply after review:\nnode scripts/apply-contribution.mjs ${responsePath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
