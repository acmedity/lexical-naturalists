#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  extractContribution,
  normalizeRepoPath,
  parseJsonText,
  validateContribution,
} from "./validate-contribution.mjs";

const ROOT = process.cwd();

function parseArgs(argv) {
  const options = {
    input: undefined,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.input) {
    throw new Error("Input response JSON path is required");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/apply-contribution.mjs <response-json> [--dry-run]\n\nValidates and applies a saved OpenRouter contribution response.\n\nBehavior:\n  - refuses to apply if validation fails\n  - create writes new files only and will not overwrite\n  - append appends exact provided content to existing files\n  - does not commit changes\n\nExamples:\n  node scripts/apply-contribution.mjs tmp/responses/foo.json --dry-run\n  node scripts/apply-contribution.mjs tmp/responses/foo.json\n`);
}

async function loadContribution(inputPath) {
  const inputText = await fs.readFile(path.resolve(ROOT, inputPath), "utf8");
  const inputJson = parseJsonText(inputText, "input file");
  return extractContribution(inputJson);
}

function normalizedOperations(contribution) {
  return contribution.files.map((file, index) => {
    const normalizedPath = normalizeRepoPath(file.path);
    if (!normalizedPath) {
      throw new Error(`files[${index}].path is not a safe relative repo path`);
    }
    return {
      index,
      path: normalizedPath,
      action: file.action,
      content: file.content,
      bytes: Buffer.byteLength(file.content || "", "utf8"),
    };
  });
}

async function applyOperation(operation) {
  const absolutePath = path.join(ROOT, operation.path);

  if (operation.action === "create") {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, operation.content, { encoding: "utf8", flag: "wx" });
    return;
  }

  if (operation.action === "append") {
    await fs.appendFile(absolutePath, operation.content, "utf8");
    return;
  }

  throw new Error(`Unsupported action: ${operation.action}`);
}

function printValidationFailure(result) {
  console.error("Validation failed; no files were applied.\n");
  if (result.errors.length) {
    console.error("Errors:");
    for (const error of result.errors) console.error(`- ${error}`);
  }
  if (result.warnings.length) {
    console.error("\nWarnings:");
    for (const warning of result.warnings) console.error(`- ${warning}`);
  }
}

function printPlan(operations, warnings) {
  console.log("Apply plan:");
  for (const operation of operations) {
    console.log(`- ${operation.action} ${operation.path} (${operation.bytes} bytes)`);
  }

  if (warnings.length) {
    console.log("\nValidation warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const contribution = await loadContribution(options.input);
  const result = await validateContribution(contribution);

  if (!result.ok) {
    printValidationFailure(result);
    process.exit(1);
  }

  const operations = normalizedOperations(contribution);
  printPlan(operations, result.warnings);

  if (options.dryRun) {
    console.log("\nDry run only; no files were changed.");
    return;
  }

  for (const operation of operations) {
    await applyOperation(operation);
  }

  console.log("\nApplied contribution. Review with: git diff");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
