#!/usr/bin/env node
/**
 * rebuild-dedupe-index.mjs -- Rebuild LIBRARY_INDEX KV from articles.json
 *
 * Runs as a post-build step in GitHub Actions deploy.
 * Reads articles.json (already fetched), extracts DOIs + title prefixes,
 * writes to KV via CF API.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN -- Cloudflare API token with KV write access
 *   CLOUDFLARE_ACCOUNT_ID -- Cloudflare account ID
 *   KV_NAMESPACE_ID -- LIBRARY_INDEX KV namespace ID
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const articlesPath = join(__dirname, "..", "src", "data", "articles.json");

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

if (!KV_NAMESPACE_ID) {
  console.error("Missing KV_NAMESPACE_ID env var");
  process.exit(1);
}

console.log(`Reading articles from: ${articlesPath}`);
const articles = JSON.parse(readFileSync(articlesPath, "utf-8"));

const doisSet = new Set();
const titlesSet = new Set();

for (const a of articles) {
  if (a.doi) doisSet.add(a.doi.toLowerCase().trim());
  if (a.title) titlesSet.add(a.title.substring(0, 40).toLowerCase().trim());
}

const index = {
  dois: [...doisSet],
  titles: [...titlesSet],
  updatedAt: new Date().toISOString(),
};

console.log(`Index: ${index.dois.length} DOIs, ${index.titles.length} titles`);
const payload = JSON.stringify(index);
console.log(`Size: ${Math.round(payload.length / 1024)} KB`);

// Write to KV via CF API
const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/dedupe-index`;

const res = await fetch(kvUrl, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${CF_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: payload,
});

if (!res.ok) {
  const err = await res.text();
  console.error(`KV write failed: ${res.status} ${err}`);
  process.exit(1);
}

console.log("Dedupe index written to KV");
