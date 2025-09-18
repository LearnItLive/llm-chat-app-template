#!/usr/bin/env node
/*
 * Ingest Support Resources CSV -> public/resources.json
 *
 * Usage:
 *   node scripts/ingest-support-csv.js --csv "public/Support Resources ... .csv" [--mode append|replace]
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { parse } = require("csv-parse/sync");

function parseArgs(argv) {
  const args = { csv: null, mode: "append" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") {
      args.csv = argv[++i];
    } else if (a === "--mode") {
      args.mode = argv[++i];
    }
  }
  if (!args.csv) {
    console.error("Missing --csv <path>");
    process.exit(1);
  }
  if (!fs.existsSync(args.csv)) {
    console.error(`CSV not found: ${args.csv}`);
    process.exit(1);
  }
  if (!["append", "replace"].includes(args.mode)) {
    console.error("--mode must be append|replace");
    process.exit(1);
  }
  return args;
}

function cleanText(input) {
  if (typeof input !== "string") return "";
  // Normalize whitespace and trim
  let s = input.replace(/[\u0000-\u001F\u007F]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeUrl(url) {
  const u = cleanText(url);
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return `https://${u}`;
}

async function main() {
  const { csv, mode } = parseArgs(process.argv);
  const workspaceRoot = process.cwd();
  const resourcesPath = path.resolve(workspaceRoot, "public", "resources.json");

  if (!fs.existsSync(resourcesPath)) {
    console.error(`resources.json not found at ${resourcesPath}`);
    process.exit(1);
  }

  const csvContent = await fsp.readFile(csv, "utf8");
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  });

  const items = [];
  for (const row of records) {
    const q = cleanText(row["Subject or Question"] || row["Subject"] || row["Question"] || "");
    const a = cleanText(row["Answer"] || "");
    const category = cleanText(row["Category"] || "");
    const subcategory = cleanText(row["Sub-Category"] || row["Subcategory"] || "");
    const url = normalizeUrl(row["More Info URL"] || row["URL"] || "");
    const extra = cleanText(row["Extra"] || "");

    if (!q || !a) continue;
    const item = { q, a };
    if (url) item.url = url;
    if (category) item.category = category;
    if (subcategory) item.subcategory = subcategory;
    if (extra) item.extra = extra;
    items.push(item);
  }

  // Deduplicate by question text
  const deduped = [];
  const seen = new Set();
  for (const it of items) {
    const key = it.q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  const original = JSON.parse(await fsp.readFile(resourcesPath, "utf8"));
  original.faq = Array.isArray(original.faq) ? original.faq : [];

  let baseFaq = mode === "replace" ? [] : original.faq;
  // Deduplicate against existing by question text
  const existingKeys = new Set(baseFaq.map((f) => (typeof f.q === "string" ? f.q.toLowerCase() : "")));
  const merged = baseFaq.concat(deduped.filter((f) => f.q && !existingKeys.has(f.q.toLowerCase())));

  const updated = { ...original, faq: merged };
  await fsp.writeFile(resourcesPath, JSON.stringify(updated, null, 2) + "\n", "utf8");

  console.log(`Ingested ${records.length} rows -> ${deduped.length} unique FAQ items.`);
  console.log(`Merged into resources.json. Total FAQ count: ${merged.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


