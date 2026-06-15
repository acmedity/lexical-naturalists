#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

const CONTRIBUTION_TYPES = new Set([
  "entry",
  "plate",
  "marginal_dissent",
  "reclassification_proposal",
  "disputed_sighting",
]);

const FILE_ACTIONS = new Set(["create", "append"]);
const REQUIRED_ENTRY_FRONTMATTER = [
  "name",
  "binomial",
  "genus",
  "status",
  "first_described",
  "observer",
  "plates",
];
const REQUIRED_ENTRY_SECTIONS = [
  "Description",
  "Status",
  "Range",
  "Call",
  "Sign",
  "Easily Confused With",
];

function parseArgs(argv) {
  const options = {
    input: undefined,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
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
  console.log(`Usage: node scripts/validate-contribution.mjs <response-json> [--json]\n\nValidates a saved OpenRouter response from scripts/request-contribution.mjs, or a raw contribution JSON file.\n\nChecks include:\n  - contribution JSON shape\n  - allowed file paths and actions\n  - create vs append filesystem safety\n  - new-entry numbering and required sections\n  - append-only SOCIETY_LOG.md requirement\n  - ASCII-only entry append content, for marginalia-style updates\n`);
}

async function pathExists(relativePath) {
  try {
    await fs.stat(path.join(ROOT, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(relativeDir, predicate = () => true) {
  try {
    const entries = await fs.readdir(path.join(ROOT, relativeDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(predicate)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export function parseJsonText(text, label) {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch (error) {
    throw new Error(`Could not parse ${label} as JSON: ${error.message}`);
  }
}

export function extractContribution(inputJson) {
  if (inputJson && Array.isArray(inputJson.files) && inputJson.contribution_type) {
    return inputJson;
  }

  if (typeof inputJson?.response_text === "string" && inputJson.response_text.trim()) {
    return parseJsonText(inputJson.response_text, "response_text");
  }

  const content = inputJson?.response?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return parseJsonText(content, "response message content");
  }

  throw new Error("Could not find contribution JSON in input file");
}

export function normalizeRepoPath(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  if (candidate.includes("\\")) return null;
  if (path.isAbsolute(candidate)) return null;

  const normalized = path.posix.normalize(candidate);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

function isAscii(text) {
  return /^[\x00-\x7F]*$/.test(text);
}

function validateTopLevel(contribution, errors, warnings) {
  if (!CONTRIBUTION_TYPES.has(contribution.contribution_type)) {
    errors.push(`Invalid contribution_type: ${contribution.contribution_type}`);
  }

  if (typeof contribution.signature !== "string" || !contribution.signature.trim()) {
    errors.push("signature must be a non-empty string");
  }

  if (typeof contribution.summary !== "string" || !contribution.summary.trim()) {
    warnings.push("summary is empty or missing");
  }

  if (!Array.isArray(contribution.files) || contribution.files.length === 0) {
    errors.push("files must be a non-empty array");
  }
}

async function validateFiles(contribution, errors, warnings) {
  const normalizedFiles = [];

  for (const [index, file] of contribution.files.entries()) {
    const label = `files[${index}]`;
    const normalizedPath = normalizeRepoPath(file?.path);

    if (!normalizedPath) {
      errors.push(`${label}.path is not a safe relative repo path`);
      continue;
    }

    if (!FILE_ACTIONS.has(file.action)) {
      errors.push(`${label}.action must be create or append`);
    }

    if (typeof file.content !== "string" || !file.content.trim()) {
      errors.push(`${label}.content must be a non-empty string`);
    }

    const isAllowedPath =
      normalizedPath === "SOCIETY_LOG.md" ||
      /^entries\/[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(normalizedPath) ||
      /^plates\/[a-z0-9]+(?:[-_][a-z0-9]+)*\.svg$/.test(normalizedPath);

    if (!isAllowedPath) {
      errors.push(`${label}.path is not in an allowed location: ${normalizedPath}`);
    }

    if (normalizedPath === "SOCIETY_LOG.md" && file.action !== "append") {
      errors.push("SOCIETY_LOG.md may only be appended to");
    }

    if (normalizedPath.startsWith("plates/") && file.action !== "create") {
      errors.push("plates/*.svg proposals must use create");
    }

    if (normalizedPath.startsWith("entries/") && file.action === "append" && !isAscii(file.content)) {
      errors.push(`${normalizedPath} append content must be ASCII-only marginalia`);
    }

    const exists = await pathExists(normalizedPath);
    if (file.action === "create" && exists) {
      errors.push(`${normalizedPath} already exists; create would overwrite it`);
    }
    if (file.action === "append" && !exists) {
      errors.push(`${normalizedPath} does not exist; append target is missing`);
    }

    normalizedFiles.push({ ...file, path: normalizedPath, exists });
  }

  const duplicateTargets = new Map();
  for (const file of normalizedFiles) {
    duplicateTargets.set(file.path, (duplicateTargets.get(file.path) || 0) + 1);
  }
  for (const [target, count] of duplicateTargets) {
    if (count > 1) warnings.push(`Multiple proposed operations target ${target}`);
  }

  return normalizedFiles;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : null;
}

function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function extractPlateNamesFromFrontmatter(frontmatter) {
  const raw = frontmatterValue(frontmatter, "plates");
  if (!raw || raw === "[]") return [];
  const bracketMatch = raw.match(/^\[(.*)\]$/);
  if (!bracketMatch) return [];
  return bracketMatch[1]
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

async function validateEntryContribution(contribution, files, errors, warnings) {
  const entryCreates = files.filter((file) => file.action === "create" && file.path.startsWith("entries/"));
  const logAppends = files.filter((file) => file.action === "append" && file.path === "SOCIETY_LOG.md");

  if (entryCreates.length !== 1) {
    errors.push("entry contributions must create exactly one entries/NNNN-headword.md file");
  }
  if (logAppends.length !== 1) {
    errors.push("entry contributions must append exactly once to SOCIETY_LOG.md");
  }

  if (entryCreates.length !== 1) return;

  const existingEntryFiles = await listFiles("entries", (name) => /^\d{4}-.*\.md$/.test(name));
  const existingNumbers = existingEntryFiles.map((name) => Number.parseInt(name.slice(0, 4), 10));
  const nextNumber = String((existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1).padStart(4, "0");
  const proposedName = path.posix.basename(entryCreates[0].path);

  if (!proposedName.startsWith(`${nextNumber}-`)) {
    errors.push(`new entry should use next unused entry number ${nextNumber}`);
  }

  validateEntryFile(entryCreates[0], files, errors, warnings);
}

function validateEntryFile(entryFile, allFiles, errors, warnings) {
  const content = entryFile.content;
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) {
    errors.push(`${entryFile.path} is missing YAML-style frontmatter`);
    return;
  }

  for (const key of REQUIRED_ENTRY_FRONTMATTER) {
    const value = frontmatterValue(frontmatter, key);
    if (value === undefined || value === "") {
      errors.push(`${entryFile.path} frontmatter missing ${key}`);
    }
  }

  for (const section of REQUIRED_ENTRY_SECTIONS) {
    const pattern = new RegExp(`^## ${section}\\s*$`, "m");
    if (!pattern.test(content)) {
      errors.push(`${entryFile.path} missing required section: ${section}`);
    }
  }

  const headword = frontmatterValue(frontmatter, "name");
  if (headword) {
    const expectedSlug = headword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (expectedSlug && !entryFile.path.endsWith(`-${expectedSlug}.md`)) {
      warnings.push(`${entryFile.path} filename may not match frontmatter name: ${headword}`);
    }
  }

  const proposedPlateCreates = new Set(
    allFiles
      .filter((file) => file.action === "create" && file.path.startsWith("plates/"))
      .map((file) => path.posix.basename(file.path)),
  );

  for (const plateName of extractPlateNamesFromFrontmatter(frontmatter)) {
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*\.svg$/.test(plateName)) {
      errors.push(`${entryFile.path} references invalid plate filename: ${plateName}`);
      continue;
    }
    if (!proposedPlateCreates.has(plateName)) {
      warnings.push(`${entryFile.path} references plate not created in this proposal: ${plateName}`);
    }
  }
}

function validateLogAppend(files, errors, warnings) {
  const logAppends = files.filter((file) => file.path === "SOCIETY_LOG.md");
  if (logAppends.length === 0) {
    errors.push("proposal must append a session note to SOCIETY_LOG.md");
    return;
  }

  for (const file of logAppends) {
    const content = file.content;
    if (!/^\s*## Session \d{4} .*$/m.test(content)) {
      errors.push("SOCIETY_LOG.md append must include a session heading");
    }
    for (const required of ["**Contributed:**", "**Occupied territory:**", "**Note to successor:**"]) {
      if (!content.includes(required)) {
        errors.push(`SOCIETY_LOG.md append missing ${required}`);
      }
    }
    if (!content.endsWith("\n")) {
      warnings.push("SOCIETY_LOG.md append should end with a newline");
    }
  }
}

function validatePlateFiles(files, errors, warnings) {
  for (const file of files.filter((candidate) => candidate.path.startsWith("plates/"))) {
    const content = file.content.trimStart();
    if (!content.startsWith("<svg") && !content.startsWith("<?xml")) {
      errors.push(`${file.path} does not look like an SVG document`);
    }
    if (!file.content.includes("</svg>")) {
      errors.push(`${file.path} is missing closing </svg>`);
    }
    if (!isAscii(file.content)) {
      warnings.push(`${file.path} contains non-ASCII characters; SVG plates usually work best as text-only artifacts`);
    }
  }
}

export async function validateContribution(contribution) {
  const errors = [];
  const warnings = [];

  validateTopLevel(contribution, errors, warnings);
  const files = Array.isArray(contribution.files)
    ? await validateFiles(contribution, errors, warnings)
    : [];

  if (files.length) {
    validateLogAppend(files, errors, warnings);
    validatePlateFiles(files, errors, warnings);
  }

  if (contribution.contribution_type === "entry") {
    await validateEntryContribution(contribution, files, errors, warnings);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    contribution: {
      contribution_type: contribution.contribution_type,
      signature: contribution.signature,
      summary: contribution.summary,
      files: files.map((file) => ({ path: file.path, action: file.action, bytes: Buffer.byteLength(file.content || "", "utf8") })),
    },
  };
}

export function printReport(result) {
  console.log(result.ok ? "Validation passed" : "Validation failed");
  console.log("");

  if (result.contribution.contribution_type) {
    console.log(`Type: ${result.contribution.contribution_type}`);
  }
  if (result.contribution.signature) {
    console.log(`Signature: ${result.contribution.signature}`);
  }
  if (result.contribution.summary) {
    console.log(`Summary: ${result.contribution.summary}`);
  }

  console.log("\nFiles:");
  for (const file of result.contribution.files) {
    console.log(`- ${file.action} ${file.path} (${file.bytes} bytes)`);
  }

  if (result.errors.length) {
    console.log("\nErrors:");
    for (const error of result.errors) console.log(`- ${error}`);
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputText = await fs.readFile(path.resolve(ROOT, options.input), "utf8");
  const inputJson = parseJsonText(inputText, "input file");
  const contribution = extractContribution(inputJson);
  const result = await validateContribution(contribution);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
