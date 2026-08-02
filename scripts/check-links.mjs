import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const files=[]; async function walk(d){for(const n of await readdir(d)){if(n===".git"||n==="node_modules"||n==="target")continue;const p=resolve(d,n),s=await stat(p);if(s.isDirectory())await walk(p);else if(n.endsWith(".md"))files.push(p)}}
await walk("."); let failed=false;
for(const file of files){const text=await readFile(file,"utf8");for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const link=m[1].split("#")[0];if(!link||/^(https?:|mailto:)/.test(link))continue;try{await stat(resolve(dirname(file),link))}catch{console.error(`${file}: broken link ${link}`);failed=true}}}if(failed)process.exit(1);
