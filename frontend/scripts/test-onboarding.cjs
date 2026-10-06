/* eslint-disable @typescript-eslint/no-require-imports -- TypeScript contract harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const storage = new Map();
global.window = {};
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
const { demoFetch, dashboardSummary } = require("../src/lib/demo-api.ts");
const { getDemoState, saveDemoState, seedDemo, resetDemo, DEMO_TOKEN, DEMO_KEY } = require("../src/lib/demo-store.ts");
const { normalizeInvoiceResponse } = require("../src/lib/invoice-contract.ts");
async function call(endpoint, body, method = body ? "POST" : "GET") {
  const response = await demoFetch(endpoint, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, ...(await response.json()) };
}
const reset = () => { resetDemo(); localStorage.setItem("token", DEMO_TOKEN); localStorage.setItem("reportingPeriodId", "period-2026"); };
const input = { reportingPeriodId: "period-2026", physicalEntityId: "building-academic-floor-0", category: "DIESEL", quantity: 100, unit: "L", activityDate: "2026-10-04", status: "SUBMITTED", calculateOnSave: true };
let checks = 0;
const check = async (name, task) => { await task(); checks++; console.log(`PASS ${name}`); };
(async () => {
  await check("Fresh login needs onboarding; profile save retains sample dashboard without duplicate hierarchy", async () => {
    reset(); assert.equal(getDemoState().onboardingCompleted, false);
    const before = dashboardSummary(getDemoState(), "period-2026").overview.totalEmissionsTonnes;
    const payload = getDemoState().onboarding;
    payload.university.legalName = "CEO Demo University"; payload.university.brandName = "CEO Demo University";
    const saved = await call("/onboarding", payload, "PUT"); assert.equal(saved.status, 200);
    const state = getDemoState(); assert.equal(state.onboardingCompleted, true); assert.equal(state.university.name, "CEO Demo University");
    assert.equal(state.collections.campuses.length, 2); assert.equal(state.collections.buildings.length, 4);
    assert.equal(state.collections.floors.length, 12); assert.equal(state.dataMode, "SAMPLE");
    assert.equal(dashboardSummary(state, "period-2026").overview.totalEmissionsTonnes, before);
  });
  await check("Invalid/manual/locked writes and Excel preview cannot switch away from sample data", async () => {
    reset(); assert.equal((await call("/activity-data", { ...input, quantity: 0 })).status, 400);
    assert.equal((await call("/activity-data", { ...input, reportingPeriodId: "period-2025", activityDate: "2025-10-04" })).status, 409);
    const fd = new FormData(); fd.append("file", new File([fs.readFileSync(path.join(__dirname, "../public/demo/unstructured-activity-sample.xlsx"))], "messy.xlsx")); fd.append("reportingPeriodId", "period-2026");
    const preview = await (await demoFetch("/activity-data/import/preview", { method: "POST", body: fd })).json();
    assert.equal(preview.data.validRows.length, 3); assert.equal(getDemoState().dataMode, "SAMPLE"); assert.equal(getDemoState().collections["activity-data"].length, 222);
  });
  await check("Save & calculate replaces samples once, accumulates later entries and survives reload", async () => {
    reset(); const first = await call("/activity-data", input); assert.equal(first.status, 201); assert.equal(first.data.status, "CALCULATED");
    assert.equal(first.data.calculations[0].co2eKg, 268);
    const second = await call("/activity-data", { ...input, category: "PURCHASED_ELECTRICITY", quantity: 1000, unit: "kWh" }); assert.equal(second.status, 201);
    const state = getDemoState(), summary = dashboardSummary(state, "period-2026");
    assert.equal(state.dataMode, "USER"); assert.equal(state.collections["activity-data"].length, 2);
    assert.equal(state.collections.baselines.length, 0); assert.equal(state.collections.targets.length, 0);
    assert.equal(summary.overview.totalEmissionsTonnes, .978); assert.equal(summary.overview.scope1Tonnes, .268); assert.equal(summary.overview.scope2Tonnes, .710);
    assert.equal(summary.overview.baselineKg, 0); assert.equal(state.collections["activity-data"].some(row => row.demoSample), false);
  });
  await check("Excel confirm switches from preview to imported-only totals and prevents duplicate import", async () => {
    reset(); const fd = new FormData(); fd.append("file", new File(["Category,Quantity,Unit,Date\nElectricity,1000,kWh,2026-10-04\nDiesel,100,L,2026-10-04"], "actual.csv")); fd.append("reportingPeriodId", "period-2026");
    const preview = await (await demoFetch("/activity-data/import/preview", { method: "POST", body: fd })).json(); assert.equal(getDemoState().dataMode, "SAMPLE");
    const payload = { jobId: preview.data.jobId, reportingPeriodId: "period-2026", calculateOnSave: true };
    const committed = await call("/activity-data/import/confirm", payload); assert.equal(committed.importedRows, 2);
    const state = getDemoState(); assert.ok(state.collections["activity-data"].every(row => row.status === "CALCULATED"));
    assert.equal(dashboardSummary(state, "period-2026").overview.totalEmissionsTonnes, .978);
    assert.equal((await call("/activity-data/import/confirm", payload)).status, 409);
  });
  await check("Invoice extraction retains demo until save; auto-calculation preserves backend values and no-result lines stay pending", async () => {
    reset(); const invoice = normalizeInvoiceResponse({ success: true, country: { region: "IN", country_name: "India" }, extraction: { provider: "gemini", invoice_date: "2026-10-04", invoice_year: 2026 }, emission: { results: [
      { item_name: "Grid", category: "electricity", value: 1000, unit: "kWh", status: "calculated", co2e: 711.7, co2e_unit: "kg", factor_value: .7117, preferred_source: "CEA 2023" },
      { item_name: "Unmatched", category: "unknown", value: 10, unit: "kg", status: "review" },
    ] } }, "invoice.pdf", "onboarding-invoice");
    const doc = (await call("/invoices/received", { invoice })).data; assert.equal(getDemoState().dataMode, "SAMPLE");
    const rows = invoice.items.map(line => ({ lineId: line.id, category: line.category, scope: line.scope, quantity: line.quantity, unit: line.unit, activityDate: "2026-10-04", campusId: "campus-main" }));
    assert.equal((await call(`/invoices/${doc.id}/import`, { reportingPeriodId: "period-2026", rows: [rows[0], { ...rows[1], quantity: -1 }], calculateOnSave: true })).status, 400);
    assert.equal(getDemoState().dataMode, "SAMPLE");
    const imported = (await call(`/invoices/${doc.id}/import`, { reportingPeriodId: "period-2026", rows, calculateOnSave: true })).data.activities;
    assert.equal(imported[0].status, "CALCULATED"); assert.equal(imported[0].calculations[0].origin, "INVOICE_BACKEND");
    assert.equal(imported[0].calculations[0].co2eKg, 711.7); assert.equal(imported[1].status, "SUBMITTED"); assert.equal(imported[1].calculations.length, 0);
    const summary = dashboardSummary(getDemoState(), "period-2026"); assert.equal(summary.overview.totalEmissionsTonnes, .7117);
    assert.equal(summary.activityStats.illustrative, 0); assert.equal(summary.activityStats.pending, 1);
  });
  await check("Older browser workspaces migrate without losing real entries or mixing sample baselines", async () => {
    reset(); const legacy = seedDemo(); legacy.version = 1; delete legacy.onboardingCompleted; delete legacy.dataMode;
    for (const rows of Object.values(legacy.collections)) for (const row of rows) delete row.demoSample;
    legacy.collections["activity-data"].unshift({ ...input, id: "activity-existing-user", status: "DRAFT", calculations: [] });
    localStorage.setItem(DEMO_KEY, JSON.stringify(legacy));
    const migrated = getDemoState(); assert.equal(migrated.version, 2); assert.equal(migrated.dataMode, "USER"); assert.equal(migrated.onboardingCompleted, true);
    assert.equal(migrated.collections["activity-data"].length, 1); assert.equal(migrated.collections["activity-data"][0].id, "activity-existing-user");
    assert.equal(migrated.collections.baselines.length, 0); saveDemoState(migrated);
    assert.equal(getDemoState().collections["activity-data"].length, 1);
  });
  await check("Deleting the last draft keeps a truthful empty user dashboard; only explicit reset restores samples", async () => {
    reset(); const draft = (await call("/activity-data", { ...input, status: "DRAFT" })).data;
    assert.equal(getDemoState().dataMode, "USER"); assert.equal((await call(`/activity-data/${draft.id}`, undefined, "DELETE")).status, 200);
    assert.equal(getDemoState().dataMode, "USER"); assert.equal(dashboardSummary(getDemoState(), "period-2026").overview.totalEmissionsTonnes, 0);
    resetDemo(); assert.equal(getDemoState().dataMode, "SAMPLE"); assert.equal(getDemoState().onboardingCompleted, false); assert.equal(getDemoState().collections["activity-data"].length, 222);
  });
  console.log(`${checks} onboarding/data-switch regression groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
