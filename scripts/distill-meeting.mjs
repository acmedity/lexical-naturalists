#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { formatModelPresets, resolveModel } from "./model-presets.mjs";

const ROOT = process.cwd();
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OUTPUT_DIR = "tmp/responses";
const DEFAULT_TEMPERATURE = 0.25;
const DEFAULT_MAX_TOKENS = 9000;

const MONTHS = new Map([
  ["Jan", "January"], ["Feb", "February"], ["Mar", "March"], ["Apr", "April"],
  ["May", "May"], ["Jun", "June"], ["Jul", "July"], ["Aug", "August"],
  ["Sep", "September"], ["Oct", "October"], ["Nov", "November"], ["Dec", "December"],
]);

function parseArgs(argv) {
  const options = {
    html: undefined,
    model: undefined,
    session: undefined,
    outputDir: DEFAULT_OUTPUT_DIR,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    minutesOnly: false,
    apply: false,
    listModels: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model" || arg === "-m") {
      options.model = argv[++i];
    } else if (arg === "--session") {
      options.session = normalizeSession(argv[++i]);
    } else if (arg === "--output-dir" || arg === "-o") {
      options.outputDir = argv[++i];
    } else if (arg === "--temperature") {
      options.temperature = Number.parseFloat(argv[++i]);
    } else if (arg === "--max-tokens") {
      options.maxTokens = Number.parseInt(argv[++i], 10);
    } else if (arg === "--minutes-only") {
      options.minutesOnly = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--list-models") {
      options.listModels = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!options.html) {
      options.html = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.listModels) return options;
  if (!options.html) throw new Error("HTML export path is required");
  if (!options.model && !options.minutesOnly) throw new Error("--model is required unless --minutes-only is used");
  if (options.model) options.model = resolveModel(options.model);
  if (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2) {
    throw new Error("--temperature must be a number between 0 and 2");
  }
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) {
    throw new Error("--max-tokens must be a positive integer");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/distill-meeting.mjs <conversation.html> --model <openrouter-model-or-preset> [options]\n\nConverts a lexical_backrooms HTML export into minutes, asks a model to distill\none entry plus a SOCIETY_LOG append, then saves a reviewable contribution JSON.\nIt does not modify archive files unless --apply is passed.\n\nExamples:\n  node scripts/distill-meeting.mjs ../lexical_backrooms/outputs/conversation_20260618_120000.html --model haiku4.5\n  node scripts/distill-meeting.mjs ../lexical_backrooms/outputs/conversation_20260618_120000.html --minutes-only --session 0013\n  node scripts/distill-meeting.mjs ../lexical_backrooms/outputs/conversation_20260618_120000.html --model haiku4.5 --apply\n\nOptions:\n  -m, --model <id>          OpenRouter model id or local preset\n      --session <NNNN>      Session/entry number (default: next unused entry number)\n  -o, --output-dir <path>   Directory for saved contribution JSON (default: ${DEFAULT_OUTPUT_DIR})\n      --temperature <n>     Sampling temperature, 0-2 (default: ${DEFAULT_TEMPERATURE})\n      --max-tokens <n>      Max output tokens (default: ${DEFAULT_MAX_TOKENS})\n      --minutes-only        Only convert HTML to a draft minutes Markdown file in tmp/\n      --apply               Apply the generated contribution after validation\n      --list-models         Show local model presets\n  -h, --help                Show this help\n\n${formatModelPresets()}\n`);
}

function normalizeSession(value) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) throw new Error("--session must be a positive integer");
  return String(n).padStart(4, "0");
}

async function nextEntryNumber() {
  const dir = path.join(ROOT, "entries");
  const files = await fs.readdir(dir);
  const nums = files
    .map((name) => name.match(/^(\d{4})-/)?.[1])
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
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
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, "");
}

function decodeHtml(text) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "],
  ]);
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named.get(entity) ?? `&${entity};`;
  });
}

function htmlContentToMarkdown(content) {
  let text = content;
  text = text.replace(/<pre(?:\s+class="[^"]*")?>([\s\S]*?)<\/pre>/gi, (_, inner) => `\n\n${decodeHtml(stripTags(inner)).trimEnd()}\n\n`);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p\s*>/gi, "\n\n");
  text = text.replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = stripTags(text);
  text = decodeHtml(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractMessages(html) {
  const blocks = [...html.matchAll(/<div class="message assistant (ai-[0-9]+)-msg">\s*<div class="message-content">\s*<div class="header">([\s\S]*?)<\/div>\s*<div class="content">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g)];
  if (!blocks.length) throw new Error("No assistant message blocks found in HTML export");

  return blocks.map((match) => {
    const header = match[2];
    const speaker = decodeHtml(stripTags(header.match(/<span class="ai-name [^"]+">([\s\S]*?)<\/span>/)?.[1] ?? match[1].toUpperCase()));
    const model = decodeHtml(stripTags(header.match(/<span class="model-name">\(([\s\S]*?)\)<\/span>/)?.[1] ?? "unknown-model"));
    const timestamp = decodeHtml(stripTags(header.match(/<span class="timestamp">([\s\S]*?)<\/span>/)?.[1] ?? ""));
    return {
      speaker,
      model,
      timestamp,
      content: htmlContentToMarkdown(match[3]),
    };
  });
}

function dateFromTimestamp(timestamp) {
  const match = String(timestamp).match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) return "undated";
  return `${MONTHS.get(match[1]) ?? match[1]} ${Number(match[2])}, ${match[3]}`;
}

function slugify(value) {
  return String(value || "meeting")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "meeting";
}

function safeFilePart(value) {
  return slugify(value).slice(0, 80) || "unknown";
}

function buildMinutes({ session, headword, sourcePath, date, messages }) {
  const relSource = path.relative(ROOT, path.resolve(ROOT, sourcePath));
  const participants = [];
  const seen = new Set();
  for (const message of messages) {
    if (seen.has(message.speaker)) continue;
    seen.add(message.speaker);
    participants.push(`- ${message.speaker}: \`${message.model}\``);
  }

  const out = [];
  out.push(`# Joint Expedition Minutes: ${headword}`);
  out.push("");
  out.push(`- Session: ${session}`);
  out.push(`- Date: ${date}`);
  out.push(`- Source export: \`${relSource}\``);
  out.push("- Runtime: `lexical_backrooms`");
  out.push("- Status: adjourned for Publisher distillation");
  out.push("");
  out.push("## Participants");
  out.push("");
  out.push(...participants);
  out.push("");
  out.push("## Transcript");
  out.push("");

  for (const message of messages) {
    out.push(message.speaker);
    out.push(`(${message.model})`);
    if (message.timestamp) out.push(message.timestamp);
    out.push(message.content);
    out.push("");
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(path.join(ROOT, filePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function logTail(logText, count = 4) {
  const sessions = logText.split(/\n(?=## Session \d{4}|# Session \d{4})/).filter((part) => /Session \d{4}/.test(part));
  return sessions.slice(-count).join("\n");
}

function buildSystemPrompt() {
  return `You are the Publisher's post-meeting distillation assistant for the Society of Lexical Naturalists. You are not a participant in the meeting. Your task is editorial: distill the supplied joint expedition transcript into one complete entry file and one SOCIETY_LOG append.\n\nFollow the archive's deadpan natural-history register. Law I is absolute: do not wink, lampshade, or write jokes that are not field observations. Preserve settled disagreements as ASCII Marginalia when present. Return JSON only.`;
}

function buildUserPrompt({ session, date, transcriptMarkdown, template, styleBible, recentLog }) {
  return `# Task\n\nDistill this joint expedition into archive-ready files. Use entry/session number ${session}. Use first_described date ${date}.\n\nReturn exactly this JSON shape:\n\n{\n  "headword": "lowercase entry headword",\n  "signature": "observer line for entry frontmatter",\n  "summary": "brief Publisher summary",\n  "entry_content": "complete content for entries/${session}-<slug>.md",\n  "society_log_append": "complete append text for SOCIETY_LOG.md, beginning with a blank line then --- then a Session ${session} heading"\n}\n\nRules:\n- entry_content must include YAML frontmatter and all mandatory sections from the template.\n- Filename slug will be derived from headword; do not include a path in JSON.\n- If the meeting contains a final closeout summary, use it as evidence, not as prose to paste blindly.\n- If there is registered dissent or Marginalia, preserve it in the entry's Marginalia section as fenced ASCII.\n- The log append must include Contributed, Occupied territory, and Note to successor.\n- Do not invent a plate unless the transcript settles one.\n- Return JSON only, with escaped newlines inside strings.\n\n# Entry template\n\n${template}\n\n# Style Bible\n\n${styleBible}\n\n# Recent Society Log\n\n${recentLog}\n\n# Meeting transcript\n\n${transcriptMarkdown}`;
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("Model response did not contain a JSON object");
}

async function callOpenRouter(options, messages) {
  await loadDotEnv();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Add it to .env or your shell environment.");

  const body = {
    model: options.model,
    messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com/",
      "X-Title": process.env.OPENROUTER_APP_NAME || "lexical-naturalists",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let responseJson;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = { non_json_response_body: responseText };
  }

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter response did not include message content");
  return { request: body, response: responseJson, responseText: content };
}

async function writeJson(outputDir, basename, data) {
  const dir = path.resolve(ROOT, outputDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${basename}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return path.relative(ROOT, filePath);
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
    child.stdout.on("data", (chunk) => { const text = chunk.toString(); stdout += text; process.stdout.write(text); });
    child.stderr.on("data", (chunk) => { const text = chunk.toString(); stderr += text; process.stderr.write(text); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) resolve({ code, stdout, stderr });
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.listModels) {
    console.log(formatModelPresets());
    return;
  }

  const session = options.session ?? await nextEntryNumber();
  const htmlPath = path.resolve(ROOT, options.html);
  const html = await fs.readFile(htmlPath, "utf8");
  const messages = extractMessages(html);
  const date = dateFromTimestamp(messages[0]?.timestamp);
  const transcriptMarkdown = messages.map((message) => `${message.speaker}\n(${message.model})\n${message.timestamp}\n${message.content}`).join("\n\n");

  if (options.minutesOnly) {
    const minutes = buildMinutes({ session, headword: "undistilled-meeting", sourcePath: htmlPath, date, messages });
    const outPath = path.join(ROOT, "tmp", `${session}-undistilled-meeting.md`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, minutes, "utf8");
    console.log(`Wrote ${path.relative(ROOT, outPath)}`);
    return;
  }

  const template = await readIfExists("entries/_TEMPLATE.md");
  const styleBible = await readIfExists("STYLE_BIBLE.md");
  const recentLog = logTail(await readIfExists("SOCIETY_LOG.md"));

  console.log("Requesting meeting distillation from OpenRouter...");
  const modelResult = await callOpenRouter(options, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt({ session, date, transcriptMarkdown, template, styleBible, recentLog }) },
  ]);

  const distilled = extractJsonObject(modelResult.responseText);
  const headword = String(distilled.headword || "").trim().toLowerCase();
  if (!headword) throw new Error("Model JSON missing headword");
  const slug = slugify(headword);
  const minutes = buildMinutes({ session, headword, sourcePath: htmlPath, date, messages });

  const contribution = {
    contribution_type: "joint_expedition",
    signature: distilled.signature || "Joint Expedition",
    summary: distilled.summary || `Distilled joint expedition for ${headword}`,
    files: [
      {
        path: `meetings/minutes/${session}-${slug}.md`,
        action: "create",
        content: minutes,
      },
      {
        path: `entries/${session}-${slug}.md`,
        action: "create",
        content: distilled.entry_content,
      },
      {
        path: "SOCIETY_LOG.md",
        action: "append",
        content: distilled.society_log_append,
      },
    ],
    notes_for_publisher: "Generated by scripts/distill-meeting.mjs; review before applying/pushing.",
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = await writeJson(options.outputDir, `${timestamp}-${safeFilePart(options.model)}-meeting-${session}-${slug}`, {
    metadata: {
      created_at: new Date().toISOString(),
      source_html: path.relative(ROOT, htmlPath),
      session,
      model: options.model,
      request: modelResult.request,
      response: modelResult.response,
    },
    ...contribution,
  });

  console.log(`Wrote ${outputPath}`);
  console.log("\n== Reporting contribution ==");
  await runNodeScript("scripts/report-contribution.mjs", [outputPath, "--preview"], { allowFailure: true });
  console.log("\n== Validating contribution ==");
  await runNodeScript("scripts/validate-contribution.mjs", [outputPath]);

  if (options.apply) {
    console.log("\n== Applying contribution ==");
    await runNodeScript("scripts/apply-contribution.mjs", [outputPath]);
  } else {
    console.log(`\nReady to review/apply:\nnode scripts/apply-contribution.mjs ${outputPath} --dry-run\nnode scripts/apply-contribution.mjs ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
