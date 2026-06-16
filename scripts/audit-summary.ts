#!/usr/bin/env bun

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: audit-summary.ts <lighthouse-report.json>");
  process.exit(1);
}

const r = JSON.parse(readFileSync(path, "utf8"));
const a = r.audits;
const sc = (o: any) => Math.round(o.score * 100);

console.log("# Lighthouse — " + (r.finalDisplayedUrl || r.finalUrl || r.requestedUrl));
console.log(
  Object.values(r.categories)
    .map((c: any) => c.title + " " + sc(c))
    .join(" | "),
);

const metrics = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
];
console.log(
  "\nMetrics: " +
    metrics
      .filter((k) => a[k])
      .map((k) => a[k].title + " " + a[k].displayValue)
      .join(" | "),
);

const fails = (Object.values(a) as any[])
  .filter((x) => x.score !== null && x.score < 0.9)
  .sort((x, y) => x.score - y.score);
console.log("\nIssues (" + fails.length + "):");
for (const x of fails) {
  const ms = x.details && x.details.overallSavingsMs
    ? " (~" + Math.round(x.details.overallSavingsMs) + "ms)"
    : "";
  console.log("- [" + Math.round(x.score * 100) + "] " + x.title + ms);
}
