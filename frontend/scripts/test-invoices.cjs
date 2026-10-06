/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS contract test harness. */
// Invoice integration checks use representative responses from the supplied ERP service.
// No live extraction provider or database is contacted by this test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const storage = new Map();
global.window = {};
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
const { normalizeInvoiceResponse, backendCalculationMatches, invoiceDate, INVOICE_MAX_BYTES } = require("../src/lib/invoice-contract.ts");
const { proxyInvoiceUpload, invoiceStatus } = require("../src/lib/invoice-proxy.ts");
const { demoFetch } = require("../src/lib/demo-api.ts");
const { getDemoState, resetDemo, DEMO_TOKEN } = require("../src/lib/demo-store.ts");
const raw = {
  success: true, country: { region: "IN", country_name: "India" },
  extraction: { provider: "gemini", vendor_name: "Invoice test supplier", invoice_number: "IN-TEST-1", invoice_date: "04/10/2026", invoice_year: 2026, currency: "INR", attempts: [{ error: "sensitive provider debug" }] },
  emission: { success: true, source_engine: "india_hybrid", total_co2e: 9025.05, total_co2e_unit: "kg", results: [
    { item_name: "Electricity consumption", category: "electricity", value: "12,500", unit: "kWh", status: "calculated", co2e: 8896.25, co2e_unit: "kg", factor_value: 0.7117, factor_unit: "kg/kWh", preferred_source: "CEA 2023", source_dataset: "CarbonSync India Fixed Factors", year: 2023 },
    { item_name: "LPG consumption", category: "lpg", value: 80, unit: "litre", status: "calculated", co2e: 128.8, co2e_unit: "kg", factor_value: 1.61, factor_unit: "kg/litre", preferred_source: "MoEFCC 2023", year: 2023 },
    { item_name: "Biomass", category: "biomass", value: 25, unit: "kg", status: "calculated", co2e: 0, co2e_unit: "kg", factor_value: 0, preferred_source: "IPCC 2006", year: 2006 },
    { item_name: "Unmatched service", category: "unknown", value: 10, unit: "kg", status: "review", co2e: "not_available", reason: "No matching factor" },
  ] },
};
const request = (file, headers = {}, url = "http://localhost:3000/api/invoices/upload") => { const form = new FormData(); if (file) form.append("file", file); return new Request(url, { method: "POST", body: form, headers: { authorization: `Bearer ${DEMO_TOKEN}`, origin: "http://localhost:3000", ...headers } }); };
const pdf = () => new File(["%PDF-1.7\nreal uploaded bytes\n%%EOF"], "IN_invoice.pdf", { type: "application/octet-stream" });
async function call(endpoint, body, method = body ? "POST" : "GET") { const response = await demoFetch(endpoint, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, ...(await response.json()) }; }
let checks = 0;
async function check(name, task) { await task(); checks++; console.log(`PASS ${name}`); }
(async () => {
  process.env.INVOICE_BACKEND_URL = "http://127.0.0.1:5000";
  process.env.INVOICE_BACKEND_RETRY_DELAY_MS = "1";
  delete process.env.INVOICE_BACKEND_AUTH_TOKEN;
  let forwarded = 0;
  global.fetch = async (url, options) => {
    forwarded++;
    assert.equal(String(url), "http://127.0.0.1:5000/api/erp/upload");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("authorization"), null);
    assert.deepEqual(Array.from(options.body.keys()), ["file"]);
    const uploaded = options.body.get("file"); assert.equal(uploaded.type, "application/pdf");
    assert.equal(await uploaded.text(), await pdf().text());
    return Response.json(raw);
  };
  await check("Actual file bytes use the canonical ERP multipart field; demo auth is not forwarded", async () => {
    const response = await proxyInvoiceUpload(request(pdf())); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(forwarded, 1); assert.equal(body.data.items.length, 4);
    assert.equal(body.data.items[0].co2eKg, 8896.25); assert.equal(body.data.provider, "gemini");
    assert.equal(body.data.items[0].factorDataset, "CarbonSync India Fixed Factors");
    assert.ok(!JSON.stringify(body).includes("sensitive provider debug"));
  });
  await check("Unauthorized, foreign-origin, empty and invalid uploads never reach the ERP", async () => {
    assert.equal((await proxyInvoiceUpload(request(pdf(), { authorization: "" }))).status, 401);
    assert.equal((await proxyInvoiceUpload(request(pdf(), { origin: "http://other.test" }))).status, 403);
    assert.equal((await proxyInvoiceUpload(request())).status, 400);
    assert.equal((await proxyInvoiceUpload(request(new File([], "empty.pdf")))).status, 413);
    assert.equal((await proxyInvoiceUpload(request(new File(["text"], "invalid.pdf")))).status, 415);
    assert.equal((await proxyInvoiceUpload(request(new File(["RIFFwebp"], "invoice.webp")))).status, 415);
    assert.equal((await proxyInvoiceUpload(request(new File([new Uint8Array(INVOICE_MAX_BYTES + 1)], "too-large.pdf")))).status, 413);
    assert.equal(forwarded, 1);
  });
  await check("Render HTTPS and custom domains work behind a proxy; foreign origins stay blocked", async () => {
    const savedRenderUrl = process.env.RENDER_EXTERNAL_URL;
    const savedPublicUrl = process.env.WORKSPACE_PUBLIC_URL;
    process.env.RENDER_EXTERNAL_URL = "https://university-demo.onrender.com";
    process.env.WORKSPACE_PUBLIC_URL = "https://carbon.example.com/";
    const internalUrl = "http://0.0.0.0:10000/api/invoices/upload";
    try {
      for (const origin of ["https://university-demo.onrender.com", "https://carbon.example.com"]) {
        assert.equal((await proxyInvoiceUpload(request(pdf(), { origin }, internalUrl))).status, 200);
      }
      for (const origin of ["null", "https://other.test", "https://university-demo.onrender.com.other.test"]) {
        assert.equal((await proxyInvoiceUpload(request(pdf(), { origin, "x-forwarded-host": "other.test", "x-forwarded-proto": "https" }, internalUrl))).status, 403);
      }
      process.env.WORKSPACE_PUBLIC_URL = "not a URL";
      assert.equal((await proxyInvoiceUpload(request(pdf(), { origin: "https://other.test" }, internalUrl))).status, 403);
    } finally {
      if (savedRenderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = savedRenderUrl;
      if (savedPublicUrl === undefined) delete process.env.WORKSPACE_PUBLIC_URL; else process.env.WORKSPACE_PUBLIC_URL = savedPublicUrl;
    }
  });
  await check("PNG/JPEG signatures work and optional backend auth stays server-side", async () => {
    process.env.INVOICE_BACKEND_AUTH_TOKEN = "test-server-token";
    global.fetch = async (_, options) => { assert.equal(options.headers.get("authorization"), "Bearer test-server-token"); return Response.json(raw); };
    for (const [bytes, name] of [[[137,80,78,71,13,10,26,10], "invoice.png"], [[255,216,255,224], "invoice.jpg"]]) assert.equal((await proxyInvoiceUpload(request(new File([new Uint8Array(bytes)], name)))).status, 200);
    delete process.env.INVOICE_BACKEND_AUTH_TOKEN;
  });
  await check("Backend failures, unexpected responses and timeouts have no sample fallback", async () => {
    global.fetch = async () => Response.json({ success: false, message: "Country could not be detected", stack: "private" }, { status: 400 });
    let response = await proxyInvoiceUpload(request(pdf())); assert.equal(response.status, 400); assert.match((await response.json()).message, /Country could not/);
    global.fetch = async () => Response.json({ success: false, message: "Provider failure" }); assert.equal((await proxyInvoiceUpload(request(pdf()))).status, 422);
    let gatewayAttempts = 0;
    const htmlGateway = () => new Response("<html>wrong service</html>", { status: 502 });
    global.fetch = async () => { gatewayAttempts++; return htmlGateway(); };
    const gateway = await proxyInvoiceUpload(request(pdf()));
    assert.equal(gateway.status, 502); assert.equal(gatewayAttempts, 2, "transient gateway failures are retried once");
    const gatewayMessage = (await gateway.json()).message;
    assert.ok(!gatewayMessage.includes("<html"), "HTML from an intermediary is never shown to the user");
    assert.match(gatewayMessage, /HTML error page/);
    gatewayAttempts = 0;
    global.fetch = async () => { gatewayAttempts++; return new Response("<html>not the invoice backend</html>"); };
    const wrongService = await proxyInvoiceUpload(request(pdf()));
    assert.equal(wrongService.status, 502); assert.equal(gatewayAttempts, 1, "a healthy-looking HTML answer is not retried");
    assert.match((await wrongService.json()).message, /HTML error page/);
    gatewayAttempts = 0;
    global.fetch = async () => ++gatewayAttempts === 1 ? htmlGateway() : Response.json(raw);
    assert.equal((await proxyInvoiceUpload(request(pdf()))).status, 200); assert.equal(gatewayAttempts, 2);
    global.fetch = async () => { throw new TypeError("Connection refused"); }; assert.equal((await proxyInvoiceUpload(request(pdf()))).status, 502); assert.equal((await (await invoiceStatus()).json()).reachable, false);
    global.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); }; assert.equal((await proxyInvoiceUpload(request(pdf()))).status, 504);
    global.fetch = async () => Response.json({ success: true }); assert.equal((await (await invoiceStatus()).json()).reachable, true);
  });
  await check("India factors, LPG litres, zero emissions and unknown rows retain backend semantics", async () => {
    const invoice = normalizeInvoiceResponse(raw, "IN_invoice.pdf", "normalized");
    assert.equal(invoice.invoiceDate, "2026-10-04"); assert.equal(invoice.items[0].quantity, 12500); assert.equal(invoice.items[0].factorValue, 0.7117);
    assert.notEqual(invoice.items[0].co2eKg, 12500 * 0.71);
    assert.equal(invoice.items[1].unit, "L"); assert.equal(invoice.items[1].co2eKg, 128.8);
    assert.equal(invoice.items[2].factorValue, 0); assert.equal(invoice.items[2].co2eKg, 0); assert.equal(invoice.items[3].co2eKg, null);
    assert.equal(backendCalculationMatches(invoice.items[2], { category: "BIOMASS", quantity: 25, unit: "kg" }), true);
    assert.equal(backendCalculationMatches(invoice.items[0], { category: "PURCHASED_ELECTRICITY", quantity: 12501, unit: "kWh" }), false);
  });
  await check("Malaysia converted units and tonne results normalize without multiplying original quantity", async () => {
    const invoice = normalizeInvoiceResponse({ success: true, country: { region: "MY", country_name: "Malaysia" }, extraction: { provider: "mistral", invoice_date: "2026", invoice_year: 2026 }, emission: { source_engine: "climatiq", results: [{ item: { name: "Steel", quantity: 2000, unit: "kg" }, category: "steel", status: "calculated", selected_factor: { factor: 1.8, factorUnit: "tCO2e/t", source: "Test official dataset", sourceDataset: "Steel factor database", factorYear: 2025 }, converted: { value: 2, unit: "t" }, emission: { co2e: 3.6, co2e_unit: "t" } }] } }, "MY_steel.pdf", "my");
    assert.equal(invoice.items[0].quantity, 2000); assert.equal(invoice.items[0].unit, "kg"); assert.equal(invoice.items[0].converted.value, 2); assert.equal(invoice.items[0].co2eKg, 3600); assert.equal(invoice.invoiceDate, ""); assert.equal(invoice.items[0].factorSource, "Test official dataset");
    assert.equal(invoiceDate("2026-02-31"), ""); assert.equal(invoiceDate("2026-10-04T00:00:00Z"), "2026-10-04");
    const zero = normalizeInvoiceResponse({ success: true, extraction: {}, emission: { preferred_source: "Climatiq", results: [{ item: { name: "Biomass", quantity: 25, unit: "kg" }, category: "biomass", status: "calculated", co2e: "not_available", emission: { co2e: 0, co2e_unit: "kg" }, selected_factor: { source: "not_available", factor: 0 } }] } }, "MY_zero.pdf", "zero");
    assert.equal(zero.items[0].co2eKg, 0); assert.equal(zero.items[0].factorSource, "Climatiq");
    const empty = normalizeInvoiceResponse({ success: true, status: "extraction_empty", extraction_provider: "affinda" }, "empty.pdf", "empty"); assert.equal(empty.items.length, 0); assert.ok(empty.warnings.length);
  });
  resetDemo(); localStorage.setItem("token", DEMO_TOKEN); localStorage.setItem("reportingPeriodId", "period-2026");
  const invoice = normalizeInvoiceResponse(raw, "IN_invoice.pdf", "persisted");
  let doc, imported;
  const row = i => ({ lineId: invoice.items[i].id, category: invoice.items[i].category, scope: invoice.items[i].scope, quantity: invoice.items[i].quantity, unit: invoice.items[i].unit, activityDate: "2026-10-04", campusId: "campus-main", buildingId: "building-academic", floorId: "building-academic-floor-0", description: invoice.items[i].name });
  const importRows = rows => call(`/invoices/${doc.id}/import`, { reportingPeriodId: "period-2026", rows });
  const base = (await call("/dashboard/summary")).data;
  await check("Invoice extraction persists once and cannot be replaced by fixture OCR", async () => {
    doc = (await call("/invoices/received", { invoice, fileSize: 100, mimeType: "application/pdf" })).data;
    assert.equal((await call("/invoices/received", { invoice })).data.id, doc.id); assert.equal(getDemoState().collections.documents.length, 1);
    assert.equal((await call(`/documents/${doc.id}/ocr`, {})).status, 409);
  });
  await check("Invoice import is atomic and rejects missing locations, bad dates and duplicate selections", async () => {
    const count = getDemoState().collections["activity-data"].length;
    for (const rows of [[row(0), { ...row(1), quantity: -1 }], [{ ...row(0), campusId: "" }], [{ ...row(0), activityDate: "2025-10-04" }], [row(0), row(0)], [{ ...row(0), lineId: "missing" }]]) { assert.ok((await importRows(rows)).status >= 400); assert.equal(getDemoState().collections["activity-data"].length, count); }
    imported = (await importRows([row(0), row(1), row(2)])).data.activities;
    assert.equal(imported.length, 3); assert.ok(imported.every(a => a.status === "SUBMITTED" && a.invoiceDocumentId === doc.id && a.campusId === "campus-main"));
    assert.equal((await importRows([row(0)])).status, 409);
    assert.equal((await call("/dashboard/summary")).data.overview.totalEmissionsTonnes, 0);
    assert.equal(getDemoState().dataMode, "USER");
    assert.equal(getDemoState().collections["activity-data"].length, 3);
    assert.ok(base.overview.totalEmissionsTonnes > 0);
  });
  await check("Review/calculation preserves real values and updates scope totals exactly once", async () => {
    for (const [i, activity] of imported.entries()) {
      assert.equal((await call(`/calculations/activity/${activity.id}`, {})).status, 409);
      await call(`/activity-data/${activity.id}/verify`, {});
      const result = (await call(`/calculations/activity/${activity.id}`, {})).data;
      assert.equal(result.co2eKg, invoice.items[i].co2eKg); assert.equal(result.origin, "INVOICE_BACKEND");
      assert.equal(result.factorValue, invoice.items[i].factorValue); assert.equal((await call(`/calculations/activity/${activity.id}`, {})).data.co2eKg, result.co2eKg);
      const activityResult = (await call(`/activity-data/${activity.id}`)).data; assert.equal(activityResult.document.invoiceResult.requestId, invoice.requestId);
    }
    const summary = (await call("/dashboard/summary")).data;
    assert.ok(Math.abs(summary.overview.scope2Tonnes - 8.89625) < 1e-9);
    assert.ok(Math.abs(summary.overview.scope1Tonnes - 0.1288) < 1e-9);
    assert.equal(summary.activityStats.invoiceBackend, 3);
  });
  await check("Edited critical fields and backend-review rows never use illustrative factors", async () => {
    const changedDoc = (await call("/invoices/received", { invoice: normalizeInvoiceResponse(raw, "changed.pdf", "changed") })).data;
    for (const [i, change] of [{ quantity: 12501 }, { unit: "MWh" }, { category: "DIESEL" }, { activityDate: "2027-02-04" }].entries()) {
      const source = changedDoc.invoiceResult.items[i === 3 ? 1 : i === 1 ? 1 : 0];
      const response = await call(`/invoices/${changedDoc.id}/import`, { reportingPeriodId: "period-2026", rows: [{ ...row(0), lineId: source.id, category: source.category, scope: source.scope, quantity: source.quantity, unit: source.unit, ...change }] });
      assert.equal(response.status, 201); const a = response.data.activities[0];
      const stored = (await call(`/documents/${changedDoc.id}`)).data;
      assert.equal(stored.linkedActivities[0].quantity, a.quantity); assert.equal(stored.linkedActivities[0].unit, a.unit); assert.equal(stored.linkedActivities[0].campus.name, "Main Campus");
      await call(`/activity-data/${a.id}/verify`, {}); assert.equal((await call(`/calculations/activity/${a.id}`, {})).status, 409);
      // Remove this row to review another edit of the same source line.
      await call(`/activity-data/${a.id}/reset`, {}); assert.equal((await call(`/activity-data/${a.id}`, undefined, "DELETE")).status, 200);
    }
    const a = (await importRows([row(3)])).data.activities[0]; await call(`/activity-data/${a.id}/verify`, {}); assert.equal((await call(`/calculations/activity/${a.id}`, {})).status, 409);
    assert.equal((await call("/dashboard/summary")).data.activityStats.invoiceBackend, 3);
  });
  await check("Locked periods reject invoice imports and calculations", async () => {
    await call("/reporting-periods/period-2026/lock", {});
    assert.equal((await importRows([row(3)])).status, 409); assert.equal((await call(`/calculations/activity/${imported[0].id}`, {})).status, 409);
    await call("/reporting-periods/period-2026/open", {});
  });
  await check("Snapshot report labels backend and illustrative counts, exports a real PDF", async () => {
    global.fetch = async url => { assert.equal(url, "/fonts/DejaVuSans.ttf"); return new Response(fs.readFileSync(path.join(__dirname, "../public/fonts/DejaVuSans.ttf"))); };
    const report = (await call("/reports/generate", { reportingPeriodId: "period-2026" })).data;
    assert.equal(report.snapshot.activityStats.invoiceBackend, 3);
    await call(`/activity-data/${imported[0].id}/reset`, {});
    assert.equal((await call(`/reports/${report.id}`)).data.snapshot.activityStats.invoiceBackend, 3);
    const response = await call(`/reports/${report.id}/download`); const blob = require("node:buffer").resolveObjectURL(response.url);
    const bytes = Buffer.from(await blob.arrayBuffer()); assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    if (process.env.INVOICE_QA_PDF) fs.writeFileSync(process.env.INVOICE_QA_PDF, bytes);
    URL.revokeObjectURL(response.url);
  });
  resetDemo(); console.log(`${checks} invoice integration groups passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
