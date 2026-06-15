#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const DEFAULT_OUTPUT = "tmp/context.md";
const DEFAULT_RECENT_ENTRIES = 3;
const DEFAULT_LOG_SESSIONS = 3;

const REQUIRED_DOCS = [
  "README.md",
  "STYLE_BIBLE.md",
  "PROTOCOL.md",
  "entries/_TEMPLATE.md",
];

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    recentEntries: DEFAULT_RECENT_ENTRIES,
    logSessions: DEFAULT_LOG_SESSIONS,
    stdout: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stdout") {
      options.stdout = true;
    } else if (arg === "--output" || arg === "-o") {
      options.output = argv[++i];
    } else if (arg === "--recent-entries") {
      options.recentEntries = Number.parseInt(argv[++i], 10);
    } else if (arg === "--log-sessions") {
      options.logSessions = Number.parseInt(argv[++i], 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.recentEntries) || options.recentEntries < 0) {
    throw new Error("--recent-entries must be a non-negative integer");
  }
  if (!Number.isInteger(options.logSessions) || options.logSessions < 0) {
    throw new Error("--log-sessions must be a non-negative integer");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/build-context.mjs [options]\n\nOptions:\n  -o, --output <path>       Write context bundle to path (default: ${DEFAULT_OUTPUT})\n      --stdout              Print context bundle instead of writing a file\n      --recent-entries <n>  Include n most recent entry files (default: ${DEFAULT_RECENT_ENTRIES})\n      --log-sessions <n>    Include n most recent complete log sessions (default: ${DEFAULT_LOG_SESSIONS})\n  -h, --help                Show this help\n`);
}

async function readText(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8");
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

function extractRecentCompleteSessions(logText, count) {
  if (count === 0) return "";

  const headingPattern = /^## Session \d{4} .*$/gm;
  const matches = [...logText.matchAll(headingPattern)];
  const sessions = [];

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : logText.length;
    const sessionText = logText.slice(start, end).trimEnd();

    // Treat a dangling heading as incomplete; the protocol wants usable minutes.
    if (sessionText.includes("**Contributed:**") && sessionText.includes("**Occupied territory:**")) {
      sessions.push(sessionText);
    }
  }

  return sessions.slice(-count).join("\n\n---\n\n");
}

function fencedSection(title, filePath, content) {
  return [`## ${title}`, "", `Source: \`${filePath}\``, "", "```markdown", content.trimEnd(), "```", ""].join("\n");
}

async function buildContext(options) {
  const entryFiles = await listFiles("entries", (name) => /^\d{4}-.*\.md$/.test(name));
  const plateFiles = await listFiles("plates", (name) => name.endsWith(".svg"));
  const recentEntryFiles = entryFiles.slice(-options.recentEntries);

  const parts = [
    "# Society of Lexical Naturalists — Contributor Context Bundle",
    "",
    "This bundle is generated for a single contributing member. Follow the repository protocol and make exactly one contribution unless instructed otherwise.",
    "",
    "## Existing archive inventory",
    "",
    "### Entries",
    "",
    entryFiles.length ? entryFiles.map((name) => `- entries/${name}`).join("\n") : "- None",
    "",
    "### Plates",
    "",
    plateFiles.length ? plateFiles.map((name) => `- plates/${name}`).join("\n") : "- None",
    "",
  ];

  for (const docPath of REQUIRED_DOCS) {
    parts.push(fencedSection(path.basename(docPath), docPath, await readText(docPath)));
  }

  const logText = await readText("SOCIETY_LOG.md");
  const recentLog = extractRecentCompleteSessions(logText, options.logSessions);
  parts.push(
    "## Recent complete society log sessions",
    "",
    "Source: `SOCIETY_LOG.md`",
    "",
    recentLog
      ? ["```markdown", recentLog, "```"].join("\n")
      : "No complete log sessions found.",
    "",
  );

  for (const entryFile of recentEntryFiles) {
    const entryPath = `entries/${entryFile}`;
    parts.push(fencedSection(entryFile, entryPath, await readText(entryPath)));
  }

  parts.push(
    "## Contributor output contract",
    "",
    "Return a proposed contribution only; do not describe repository operations as if you performed them.",
    "The Publisher or an automated runner will apply, validate, and review any proposed files.",
    "",
  );

  return `${parts.join("\n").trimEnd()}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const context = await buildContext(options);

  if (options.stdout) {
    process.stdout.write(context);
    return;
  }

  const outputPath = path.resolve(ROOT, options.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, context, "utf8");
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
