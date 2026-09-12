// Usage: node scripts/validate-vocab.ts [files...]   (defaults to data/vocab/*.json)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandDataset, type CompactDataset } from "../src/data/compactFormat.ts";
import { validateWords } from "../src/data/validate.ts";

const dir = "data/vocab";
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

let errors = 0;
let total = 0;
const allWords = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8")) as CompactDataset;
  const words = expandDataset(data);
  allWords.push(...words);
  total += words.length;
  const senses = words.reduce((n, w) => n + w.senses.length, 0);
  const sentences = words.reduce((n, w) => n + w.senses.reduce((m, s) => m + s.sentences.length, 0), 0);
  console.log(`${file}: ${words.length} words, ${senses} senses, ${sentences} sentences · source=${data.meta.source} license=${data.meta.license ?? "?"}`);
}
const problems = validateWords(allWords);
for (const p of problems) {
  if (p.severity === "error") errors++;
  console.log(`  ${p.severity.toUpperCase()} ${p.where}: ${p.message}`);
}
console.log(`${total} words across ${files.length} file(s); ${errors} error(s), ${problems.length - errors} warning(s).`);
process.exit(errors ? 1 : 0);
