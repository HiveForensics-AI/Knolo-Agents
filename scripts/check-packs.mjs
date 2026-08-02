import { readdir, readFile } from "node:fs/promises";
for (const name of await readdir("examples/packs")) {
  if (!name.endsWith(".knolo")) continue;
  const text = await readFile(`examples/packs/${name}`, "utf8");
  for (const field of ["version: 1", "id: examples.", "capabilities:", "namespaces:", "max_steps:", "max_calls:"]) if (!text.includes(field)) throw new Error(`${name}: missing ${field}`);
  if (/max_calls:\s+(?:[2-9]|\d{2,})/.test(text)) throw new Error(`${name}: example authority is broader than one call`);
}
