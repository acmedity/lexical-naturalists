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
    json: false,
    preview: false,
    previewLines: 8,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--preview") {
      options.preview = true;
    } else if (arg === "--preview-lines") {
      options.previewLines = Number.parseInt(argv[++i], 10);
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
  if (!Number.isInteger(options.previewLines) || options.previewLines < 1) {
    throw new Error("--preview-lines must be a positive integer");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/report-contribution.mjs <response-json> [options]\n\nSummarizes a saved OpenRouter contribution response for Publisher review.\n\nOptions:\n      --preview            Include short content previews\n      --preview-lines <n>  Lines per preview when --preview is enabled (default: 8)\n      --json               Print machine-readable report\n  -h, --help               Show this help\n`);
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : null;
}

function frontmatterValue(frontmatter, key) {
  if (!frontmatter) return undefined;
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function extractHeading(content, level = 1) {
  const hashes = "#".repeat(level);
  const match = content.match(new RegExp(`^${hashes}\\s+(.+)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function extractSessionHeading(content) {
  const match = content.match(/^\s*(## Session \d{4} .*)$/m);
  return match ? match[1].trim() : undefined;
}

function extractSectionHeadings(content) {
  return [...content.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
}

function countLines(content) {
  if (!content) return 0;
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}

function firstLines(content, limit) {
  const lines = content.split(/\r?\n/);
  const preview = lines.slice(0, limit).join("\n");
  const omitted = Math.max(0, lines.length - limit);
  return { preview, omitted };
}

function summarizeInput(inputJson) {
  const request = inputJson.request || {};
  const response = inputJson.response || {};
  const metadata = inputJson.metadata || {};

  return {
    metadata,
    request: {
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      message_count: Array.isArray(request.messages) ? request.messages.length : undefined,
    },
    response: {
      id: response.id,
      model: response.model,
      http_status: metadata.http_status,
      ok: metadata.ok,
      usage: response.usage,
      choices: Array.isArray(response.choices) ? response.choices.length : undefined,
      error: response.error,
      has_response_text: typeof inputJson.response_text === "string" && inputJson.response_text.trim().length > 0,
    },
  };
}

function summarizeFiles(contribution) {
  return contribution.files.map((file, index) => {
    const safePath = normalizeRepoPath(file.path) || file.path;
    const content = typeof file.content === "string" ? file.content : "";
    const summary = {
      index,
      path: safePath,
      action: file.action,
      bytes: Buffer.byteLength(content, "utf8"),
      lines: countLines(content),
    };

    if (safePath === "SOCIETY_LOG.md") {
      summary.kind = "society_log_append";
      summary.session_heading = extractSessionHeading(content);
    } else if (String(safePath).startsWith("entries/")) {
      summary.kind = file.action === "create" ? "entry_file" : "entry_append";
      const frontmatter = extractFrontmatter(content);
      summary.entry = {
        title: extractHeading(content, 1),
        name: frontmatterValue(frontmatter, "name"),
        binomial: frontmatterValue(frontmatter, "binomial"),
        genus: frontmatterValue(frontmatter, "genus"),
        status: frontmatterValue(frontmatter, "status"),
        observer: frontmatterValue(frontmatter, "observer"),
        plates: frontmatterValue(frontmatter, "plates"),
        sections: extractSectionHeadings(content),
      };
    } else if (String(safePath).startsWith("plates/")) {
      summary.kind = "plate_svg";
      summary.svg_title = content.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    } else {
      summary.kind = "unknown";
    }

    return summary;
  });
}

async function buildReport(inputPath) {
  const absoluteInputPath = path.resolve(ROOT, inputPath);
  const inputText = await fs.readFile(absoluteInputPath, "utf8");
  const inputJson = parseJsonText(inputText, "input file");

  const report = {
    input: path.relative(ROOT, absoluteInputPath),
    saved_response: summarizeInput(inputJson),
    contribution_found: false,
    contribution_parse_error: undefined,
    contribution: undefined,
    validation: undefined,
    next_steps: [],
  };

  let contribution;
  try {
    contribution = extractContribution(inputJson);
  } catch (error) {
    report.contribution_parse_error = error.message;
    report.next_steps.push("Run scripts/request-contribution.mjs without --dry-run to obtain a model contribution response.");
    return report;
  }

  report.contribution_found = true;
  report.contribution = {
    contribution_type: contribution.contribution_type,
    signature: contribution.signature,
    summary: contribution.summary,
    notes_for_publisher: contribution.notes_for_publisher,
    files: summarizeFiles(contribution),
  };

  const validation = await validateContribution(contribution);
  report.validation = {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
  };

  if (validation.ok) {
    report.next_steps.push(`node scripts/apply-contribution.mjs ${report.input} --dry-run`);
    report.next_steps.push(`node scripts/apply-contribution.mjs ${report.input}`);
  } else {
    report.next_steps.push(`Review validation errors, then request a corrected contribution or edit the saved response copy.`);
  }

  return report;
}

function printSavedResponse(report) {
  const saved = report.saved_response;
  console.log(`Input: ${report.input}`);

  if (saved.metadata.created_at) console.log(`Created: ${saved.metadata.created_at}`);
  if (saved.request.model) console.log(`Requested model: ${saved.request.model}`);
  if (saved.response.model) console.log(`Response model: ${saved.response.model}`);
  if (saved.response.http_status !== undefined) console.log(`HTTP status: ${saved.response.http_status}`);
  if (saved.request.temperature !== undefined) console.log(`Temperature: ${saved.request.temperature}`);
  if (saved.request.max_tokens !== undefined) console.log(`Max tokens: ${saved.request.max_tokens}`);

  const usage = saved.response.usage;
  if (usage) {
    const parts = [];
    if (usage.prompt_tokens !== undefined) parts.push(`prompt ${usage.prompt_tokens}`);
    if (usage.completion_tokens !== undefined) parts.push(`completion ${usage.completion_tokens}`);
    if (usage.total_tokens !== undefined) parts.push(`total ${usage.total_tokens}`);
    if (parts.length) console.log(`Usage: ${parts.join(", ")}`);
  }

  if (saved.response.error) {
    console.log(`Provider error: ${JSON.stringify(saved.response.error)}`);
  }
}

function printContribution(report, options) {
  if (!report.contribution_found) {
    console.log("\nNo contribution JSON found.");
    console.log(`Reason: ${report.contribution_parse_error}`);
    return;
  }

  const contribution = report.contribution;
  console.log("\nContribution:");
  console.log(`Type: ${contribution.contribution_type}`);
  console.log(`Signature: ${contribution.signature}`);
  if (contribution.summary) console.log(`Summary: ${contribution.summary}`);
  if (contribution.notes_for_publisher) console.log(`Notes for Publisher: ${contribution.notes_for_publisher}`);

  console.log("\nProposed files:");
  for (const file of contribution.files) {
    console.log(`- ${file.action} ${file.path} (${file.lines} lines, ${file.bytes} bytes)`);
    if (file.session_heading) console.log(`  ${file.session_heading}`);
    if (file.entry?.name || file.entry?.title) {
      console.log(`  entry: ${file.entry.name || file.entry.title}`);
      if (file.entry.binomial) console.log(`  binomial: ${file.entry.binomial}`);
      if (file.entry.genus || file.entry.status) console.log(`  genus/status: ${[file.entry.genus, file.entry.status].filter(Boolean).join(" / ")}`);
      if (file.entry.observer) console.log(`  observer: ${file.entry.observer}`);
      if (file.entry.plates) console.log(`  plates: ${file.entry.plates}`);
    }
    if (file.svg_title) console.log(`  svg title: ${file.svg_title}`);
  }

  if (options.preview) {
    console.log("\nPreviews:");
    for (const rawFile of contribution.files) {
      const content = rawFile.content || "";
      const { preview, omitted } = firstLines(content, options.previewLines);
      console.log(`\n--- ${rawFile.action} ${rawFile.path} ---`);
      console.log(preview);
      if (omitted > 0) console.log(`[... ${omitted} more lines omitted ...]`);
    }
  }
}

function printValidation(report) {
  if (!report.validation) return;

  console.log("\nValidation:");
  console.log(report.validation.ok ? "Passed" : "Failed");

  if (report.validation.errors.length) {
    console.log("\nErrors:");
    for (const error of report.validation.errors) console.log(`- ${error}`);
  }

  if (report.validation.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of report.validation.warnings) console.log(`- ${warning}`);
  }
}

function printNextSteps(report) {
  if (!report.next_steps.length) return;
  console.log("\nNext steps:");
  for (const step of report.next_steps) console.log(`- ${step}`);
}

function printReport(report, options) {
  console.log("Contribution report");
  console.log("===================\n");
  printSavedResponse(report);
  printContribution(report, options);
  printValidation(report);
  printNextSteps(report);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport(options.input);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report, options);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
