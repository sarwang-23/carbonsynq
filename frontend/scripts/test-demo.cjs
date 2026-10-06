/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness transpiles the app's TypeScript. */
// Regression checks for the browser demo contract; run with npm run test:demo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const storage = new Map();
global.window = {};
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
global.fetch = async url => {
  assert.equal(url, "/fonts/DejaVuSans.ttf");
  return new Response(fs.readFileSync(path.join(__dirname, "../public/fonts/DejaVuSans.ttf")));
};
const { demoFetch, dashboardSummary } = require("../src/lib/demo-api.ts");
const { getDemoState, resetDemo, DEMO_TOKEN, DEMO_EMAIL, DEMO_PASSWORD } = require("../src/lib/demo-store.ts");
async function call(endpoint, body, method = body ? "POST" : "GET") {
  const response = await demoFetch(endpoint, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, ...(await response.json()) };
}
let checks = 0;
async function check(name, task) { await task(); checks++; console.log(`PASS ${name}`); }
(async () => {
  await check("Demo authentication rejects other credentials", async () => {
    assert.equal((await call("/dashboard/summary")).status, 401);
    assert.equal((await call("/auth/login", { email: "invalid@example.test", password: "wrong" })).status, 401);
    const auth = await call("/auth/login", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.equal(auth.data.token, DEMO_TOKEN);
    localStorage.setItem("token", auth.data.token);
    localStorage.setItem("reportingPeriodId", "period-2026");
  });
  const baseline = (await call("/dashboard/summary")).data;
  await check("Scopes, monthly series and inventory reconcile exactly", async () => {
    const total = baseline.overview.totalEmissionsTonnes;
    assert.ok(total > 0);
    assert.ok(Math.abs(total - baseline.categories.reduce((n, c) => n + c.tonnesCO2e, 0)) < 0.000001);
    assert.ok(Math.abs(total * 1000 - baseline.trends.reduce((n, t) => n + t.totalKg, 0)) < 0.000001);
    const inventory = (await call("/university/inventory?periodId=period-2026")).data.items;
    assert.ok(Math.abs(total - inventory.reduce((n, r) => n + r.value_tco2e, 0)) < 0.000001);
    const filtered = (await call("/dashboard/summary?campusId=campus-research")).data;
    assert.ok(filtered.overview.totalEmissionsTonnes < total);
  });
  let activityId;
  await check("Manual entry, review and calculation update totals once", async () => {
    const created = await call("/activity-data", { category: "DIESEL", quantity: 100, unit: "litre", activityDate: "2026-10-04", reportingPeriodId: "period-2026", physicalEntityId: "building-academic-floor-0" });
    assert.equal(created.status, 201); activityId = created.data.id;
    assert.equal(created.data.campusId, "campus-main"); assert.equal(created.data.buildingId, "building-academic");
    assert.equal((await call(`/calculations/activity/${activityId}`, {})).status, 409);
    assert.equal((await call(`/activity-data/${activityId}/submit`, {})).data.status, "SUBMITTED");
    assert.equal((await call(`/activity-data/${activityId}/verify`, {})).data.status, "VERIFIED");
    assert.equal((await call(`/calculations/activity/${activityId}`, {})).data.co2eKg, 268);
    assert.equal((await call(`/calculations/activity/${activityId}`, {})).data.co2eKg, 268);
    const total = (await call("/dashboard/summary")).data.overview.totalEmissionsTonnes;
    assert.ok(Math.abs(total - 0.268) < 0.000001);
    assert.equal(getDemoState().dataMode, "USER");
    assert.equal(getDemoState().collections["activity-data"].length, 1);
    assert.equal(getDemoState().collections.baselines.length, 0);
  });
  await check("Locked periods reject creation, transitions and calculations", async () => {
    await call("/reporting-periods/period-2026/lock", {});
    assert.equal((await call(`/activity-data/${activityId}/reset`, {})).status, 409);
    assert.equal((await call(`/calculations/activity/${activityId}`, {})).status, 409);
    assert.equal((await call("/activity-data", { category: "DIESEL", quantity: 1, unit: "L", activityDate: "2026-10-04", reportingPeriodId: "period-2026" })).status, 409);
    await call("/reporting-periods/period-2026/open", {});
  });
  await check("Invalid quantities, dates and scope/unit mismatches are rejected", async () => {
    const valid = { category: "DIESEL", quantity: 20, unit: "L", activityDate: "2026-10-04", reportingPeriodId: "period-2026" };
    for (const changed of [{ quantity: -1 }, { quantity: "NaN" }, { activityDate: "2025-01-01" }, { unit: "kg" }, { scope: "SCOPE_2" }]) assert.equal((await call("/activity-data", { ...valid, ...changed })).status, 400);
    assert.equal((await call(`/activity-data/${activityId}/reject`, {})).status, 409);
  });
  await check("Unstructured XLSX normalizes headers and rejects invalid rows", async () => {
    const file = new File([fs.readFileSync(path.join(__dirname, "../public/demo/unstructured-activity-sample.xlsx"))], "messy.xlsx");
    const fd = new FormData(); fd.append("file", file); fd.append("reportingPeriodId", "period-2026");
    const response = await demoFetch("/activity-data/import/preview", { method: "POST", body: fd });
    const { data } = await response.json();
    assert.equal(data.validRows.length, 3); assert.equal(data.invalidRows.length, 1);
    assert.equal(data.validRows[0].quantity, 12500); assert.equal(data.validRows[1].unit, "L");
    assert.equal(data.validRows[0].buildingId, "building-academic");
    const commit = await call("/activity-data/import/confirm", { jobId: data.jobId, reportingPeriodId: "period-2026", validData: [] });
    assert.equal(commit.importedRows, 3);
    assert.equal((await call("/activity-data/import/confirm", { jobId: data.jobId, reportingPeriodId: "period-2026" })).status, 409);
  });
  await check("Only the bundled sample invoice gets preset review fields", async () => {
    for (const name of ["sample-electricity-invoice.pdf", "my-invoice.pdf"]) {
      const upload = await demoFetch("/documents/upload", { method: "POST", body: new File(["%PDF-test"], name, { type: "application/pdf" }) });
      const doc = (await upload.json()).data;
      const reviewed = await call(`/operations/documents/${doc.id}/ocr`, {});
      assert.equal(reviewed.data.extractedData.quantity, name.startsWith("sample-") ? 12500 : undefined);
    }
  });
  await check("Report snapshot stays fixed and download is a real PDF", async () => {
    const report = (await call("/reports/generate", { reportingPeriodId: "period-2026" })).data;
    await call(`/activity-data/${activityId}/reset`, {});
    const snapshot = (await call(`/reports/${report.id}`)).data.snapshot;
    assert.equal(snapshot.overview.totalEmissionsTonnes, report.snapshot.overview.totalEmissionsTonnes);
    assert.ok(snapshot.overview.totalEmissionsTonnes > dashboardSummary(getDemoState(), "period-2026").overview.totalEmissionsTonnes);
    const response = await call(`/reports/${report.id}/download`);
    assert.ok(response.url.startsWith("blob:"));
    const file = URL.resolveObjectURL ? URL.resolveObjectURL(response.url) : require("node:buffer").resolveObjectURL(response.url);
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
    if (process.env.DEMO_QA_PDF) fs.writeFileSync(process.env.DEMO_QA_PDF, bytes);
    URL.revokeObjectURL(response.url);
  });
  await check("Targets expose finite, month-aligned progress and new baselines keep totals", async () => {
    resetDemo(); localStorage.setItem("token", DEMO_TOKEN); localStorage.setItem("reportingPeriodId", "period-2026");
    const progress = (await call("/targets/target-2030/progress?periodId=period-2026")).data;
    for (const key of ["baselineTCO2e", "currentTCO2e", "requiredReductionTCO2e", "progressPercent"]) assert.ok(Number.isFinite(progress[key]), key);
    assert.equal(progress.currentTCO2e, Math.round(baseline.overview.totalEmissionsTonnes * 1000) / 1000);
    const created = (await call("/baselines", { reportingPeriodId: "period-2026" })).data;
    assert.equal(created.totalKgCO2e, created.totalCo2eKg);
    assert.ok(created.totalKgCO2e > 0);
    const target = (await call("/targets", { baselineId: created.id, targetYear: 2031, reductionPct: 20 })).data;
    assert.equal(target.baselineId, created.id);
    assert.ok(Number.isFinite(target.targetCo2eKg));
  });
  await check("Demo state persists and reset restores the original sample", async () => {
    assert.ok(getDemoState().collections["audit-logs"].length >= 3);
    resetDemo();
    assert.equal(getDemoState().collections.documents.length, 0);
    assert.equal(getDemoState().collections["activity-data"].length, 222);
  });
  console.log(`${checks} demo regression groups passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
