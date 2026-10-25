import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareBreakdown, cloudflareDailyTraffic, cloudflareMetricSummary, selectCloudflareMetric,
  type CloudflareCache, type CloudflareSnapshot
} from "../src/pages/cloudflareAudienceReport.js";

const now = new Date("2026-10-19T12:00:00Z");
const row = (partial: Partial<CloudflareSnapshot>): CloudflareSnapshot => ({
  source: "cloudflare_http", metric: "traffic", day: "2026-10-18",
  rows: [{ label: "all", count: 12 }], sampleInterval: 4, coverage: "observed",
  fetchedAt: "2026-10-19T10:00:00Z", ...partial
});
const cache = (snapshots: CloudflareSnapshot[], truncated = false): CloudflareCache =>
  ({ configured: true, snapshots, truncated });

test("date windows, source, and metric remain separate", () => {
  const data = cache([
    row({}), row({ metric: "country", rows: [{ label: "Canada", count: 9 }] }),
    row({ source: "cloudflare_web_analytics", metric: "referrer", rows: [{ label: "example.org", count: 3 }] }),
    row({ day: "2026-10-10", rows: [{ label: "all", count: 2 }] }),
    row({ day: "2026-08-01", rows: [{ label: "all", count: 1 }] }),
    row({ day: "2026-02-30" }), row({ day: "2026-10-20" })
  ]);
  assert.deepEqual(selectCloudflareMetric(data, "traffic", "7d", now).map((entry) => entry.day), ["2026-10-18"]);
  assert.deepEqual(selectCloudflareMetric(data, "traffic", "30d", now).map((entry) => entry.day), ["2026-10-10", "2026-10-18"]);
  assert.equal(selectCloudflareMetric(data, "traffic", "all", now).length, 3);
  assert.equal(selectCloudflareMetric(data, "referrer", "7d", now).length, 1);
});

test("later committed cache rows replace older observations without double counting", () => {
  const data = cache([row({ rows: [{ label: "all", count: 12 }] }),
    row({ fetchedAt: "2026-10-19T11:00:00Z", rows: [{ label: "all", count: 15 }] })]);
  const selected = selectCloudflareMetric(data, "traffic", "7d", now);
  assert.equal(selected.length, 1);
  assert.equal(cloudflareMetricSummary(selected).total, 15);
});

test("unknown days are gaps, not zero traffic or conversion inputs", () => {
  const data = cache([row({ day: "2026-10-17", rows: [], coverage: "unknown" }),
    row({ day: "2026-10-18", rows: [{ label: "all", count: 0 }], coverage: "observed" })]);
  const selected = selectCloudflareMetric(data, "traffic", "7d", now);
  const trend = cloudflareDailyTraffic(selected, "7d", now);
  assert.equal(trend.find((entry) => entry.day === "2026-10-17")?.count, null);
  assert.equal(trend.find((entry) => entry.day === "2026-10-18")?.count, 0);
  assert.equal(trend.find((entry) => entry.day === "2026-10-16")?.count, null);
  assert.equal(cloudflareMetricSummary(selected).daysWithData, 1);
  assert.equal(cloudflareMetricSummary(selected).incomplete, true);
});

test("all-time chart ends at the newest cached day when refresh is old", () => {
  const selected = selectCloudflareMetric(cache([row({ day: "2026-09-01" }), row({ day: "2026-09-03" })]), "traffic", "all", now);
  const trend = cloudflareDailyTraffic(selected, "all", now);
  assert.deepEqual(trend.map((entry) => entry.day), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.equal(trend[1].count, null);
});

test("rankings and labels expose sampling and truncated coverage", () => {
  const data = cache([row({ metric: "country", rows: [{ label: "Canada", count: 8 }, { label: "US", count: 2 }], coverage: "truncated" }),
    row({ metric: "country", day: "2026-10-19", rows: [{ label: "Canada", count: 3 }], coverage: "partial_day", sampleInterval: 10 })], true);
  const selected = selectCloudflareMetric(data, "country", "7d", now);
  assert.deepEqual(cloudflareBreakdown(selected), [{ label: "Canada", count: 11 }, { label: "US", count: 2 }]);
  assert.deepEqual({ sampled: cloudflareMetricSummary(selected, data.truncated).maxSampleInterval,
    truncated: cloudflareMetricSummary(selected, data.truncated).truncated,
    partial: cloudflareMetricSummary(selected, data.truncated).partialToday },
  { sampled: 10, truncated: true, partial: true });
});
