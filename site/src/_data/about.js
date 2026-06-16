import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

const md = new MarkdownIt({ html: true, typographer: true });

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

// Strip the first H1 — we'll let the page provide its own headings.
function stripFirstH1(text) {
  return text.replace(/^#\s+.+(\n###?\s+.+)?\n+/, "").trim();
}

export default {
  charter:  md.render(stripFirstH1(read("README.md"))),
  bylaws:   md.render(stripFirstH1(read("STYLE_BIBLE.md"))),
  protocol: md.render(stripFirstH1(read("PROTOCOL.md"))),
};
