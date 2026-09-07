import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const REPO = "https://github.com/HiveForensics-AI/Knolo-Agents";
const REPO_HOST_PATH = "github.com/HiveForensics-AI/Knolo-Agents";
const root = resolve(".");
const skipDirs = new Set([".git", "node_modules", "target", "dist"]);
const files = [];
let failed = false;

async function walk(dir) {
  for (const name of await readdir(dir)) {
    if (skipDirs.has(name)) continue;
    const path = resolve(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) await walk(path);
    else if (name.endsWith(".md") || name === "Cargo.toml" || name === "package.json") files.push(path);
  }
}

function report(file, message) {
  console.error(`${file}: ${message}`);
  failed = true;
}

function checkGithubUrl(file, link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    report(file, `invalid URL ${link}`);
    return;
  }
  const hostPath = `${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (!hostPath.startsWith(REPO_HOST_PATH)) {
    report(file, `GitHub URL must use ${REPO}, got ${link}`);
    return;
  }
  const rest = hostPath.slice(REPO_HOST_PATH.length).replace(/^\/+/, "");
  if (!rest || rest === ".git" || rest === "issues") return;
  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === "issues") return;
  if (parts[0] !== "blob" && parts[0] !== "tree") {
    report(file, `unexpected GitHub path ${link}`);
    return;
  }
  const ref = parts[1];
  if (!ref) {
    report(file, `missing GitHub ref in ${link}`);
    return;
  }
  // crates.io rewrites workspace README relative links to blob/HEAD/<crate>/...,
  // which 404s. Published crate docs must use the default branch at repo root.
  if (ref === "HEAD") {
    report(file, `refuses ${parts[0]}/HEAD (use ${parts[0]}/main at repo root): ${link}`);
    return;
  }
  if (ref !== "main") {
    report(file, `GitHub ref must be main, got ${ref} in ${link}`);
    return;
  }
  const repoPath = parts.slice(2).join("/");
  if (!repoPath) return;
  return stat(resolve(root, repoPath)).catch(() => {
    report(file, `GitHub path does not exist in the repository: ${repoPath} (${link})`);
  });
}

await walk(".");

for (const file of files) {
  const text = await readFile(file, "utf8");
  if (file.endsWith(".md")) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].trim().split("#")[0].split("?")[0];
      if (!link || link.startsWith("mailto:")) continue;
      if (/^https?:\/\//i.test(link)) {
        if (/github\.com/i.test(link)) await checkGithubUrl(file, link);
        continue;
      }
      try {
        await stat(resolve(dirname(file), link));
      } catch {
        report(file, `broken link ${link}`);
      }
    }
    continue;
  }

  for (const match of text.matchAll(/https:\/\/github\.com\/[^\s"'\\]+/g)) {
    const link = match[0].replace(/[.,);]+$/, "");
    await checkGithubUrl(file, link);
  }
}

if (failed) process.exit(1);
