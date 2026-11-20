import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist"]);
const files = [];
const errors = [];

async function collect(directory) {
  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    if (ignored.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path);
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
}

function prose(source) {
  let fence = null;
  return source
    .split("\n")
    .map((line) => {
      const mark = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (mark) {
        if (!fence) {
          fence = mark[1];
        } else if (mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) {
          fence = null;
        }
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function headings(source) {
  const counts = new Map();
  const anchors = new Set();
  const content = prose(source);
  for (const match of content.matchAll(/<a\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi)) {
    anchors.add(match[1]);
  }
  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (!heading) {
      continue;
    }
    const slug = heading[1]
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    anchors.add(count ? slug + "-" + count : slug);
    counts.set(slug, count + 1);
  }
  return anchors;
}

await collect(root);
let checked = 0;
for (const file of files) {
  const source = prose(await readFile(file, "utf8"));
  const links = /\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)|<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let link = links.exec(source);
  while (link) {
    const value = (link[1] ?? link[2]).replace(/^<|>$/g, "");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      const [path, fragment] = value.split("#");
      const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      const location =
        file.slice(root.length) + ":" + source.slice(0, link.index).split("\n").length;
      checked += 1;
      try {
        await stat(target);
        if (
          fragment &&
          extname(target) === ".md" &&
          !headings(await readFile(target, "utf8")).has(decodeURIComponent(fragment))
        ) {
          errors.push(location + " missing heading: " + value);
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        errors.push(location + " missing file: " + value);
      }
    }
    link = links.exec(source);
  }
}
const demoDirectory = join(root, "docs/assets/demos");
const demos = (await readdir(demoDirectory)).filter((name) => name.endsWith(".gif"));
for (const demo of demos) {
  const path = join(demoDirectory, demo);
  const bytes = await readFile(path);
  if (!["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) {
    errors.push("Invalid GIF: " + demo);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Documentation: " + checked + " local links and " + demos.length + " GIF files verified",
  );
}
