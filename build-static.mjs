import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const templatePath = join(root, "runtime", "preview.template.html");
const stylePath = join(root, "runtime", "runtime.css");
const scriptPaths = [
  "capabilities.js",
  "adapter.js",
  "compatibility.js",
  "renderer.js",
  "interpreter.js",
  "model-validation.js",
  "capture.js",
  "preview.js"
].map(name => join(root, "runtime", name));

const [template, style, ...scripts] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(stylePath, "utf8"),
  ...scriptPaths.map(path => readFile(path, "utf8"))
]);
const script = scripts.join("\n");
const styleHash = hash(style);
const scriptHash = hash(script);
const policy = `default-src 'none'; script-src '${scriptHash}'; style-src '${styleHash}'; img-src data: blob:; media-src data: blob:; connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://languageapp-5e07a-default-rtdb.firebaseio.com; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`;
if (!["{{CSP}}", "{{STYLE}}", "{{SCRIPT}}"].every(marker => template.includes(marker))) {
  throw new Error("Preview template is missing a required placeholder.");
}
const html = template
  .replace("{{CSP}}", () => policy)
  .replace("{{STYLE}}", () => style)
  .replace("{{SCRIPT}}", () => script);

await writeFile(join(root, "runtime", "preview.html"), html);
process.stdout.write("Built runtime/preview.html with hash-only script and style policies.\n");

function hash(source) {
  return `sha256-${createHash("sha256").update(source).digest("base64")}`;
}
