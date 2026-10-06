import {
  DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOKEN, DEMO_ORG, getDemoState, saveDemoState,
  activateUserData, audit, makeCalculation, newId, round, sumKg, type DemoState, type Row,
} from "./demo-store";
import { backendCalculationMatches, invoiceUnit, INVOICE_CATEGORIES, type InvoiceLine } from "./invoice-contract";

class DemoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const ok = (data: any, status = 200, extra: Row = {}) => Response.json({ success: true, data, ...extra }, { status });
const find = (rows: Row[], id: string) => {
  const row = rows.find(r => r.id === id);
  if (!row) throw new DemoError("Record not found", 404);
  return row;
};
const selectedPeriod = (s: DemoState, q: URLSearchParams) => q.get("reportingPeriodId") || q.get("periodId") || localStorage.getItem("reportingPeriodId") || s.collections["reporting-periods"][0]?.id;

function assertEditable(s: DemoState, periodId: string) {
  const period = find(s.collections["reporting-periods"], periodId);
  if (period.status === "LOCKED") throw new DemoError("This reporting period is locked. Reopen it before making changes.", 409);
  return period;
}

export function periodRows(s: DemoState, periodId: string, q = new URLSearchParams()): Row[] {
  return s.collections["activity-data"].filter(a => (!periodId || a.reportingPeriodId === periodId)
    && ["campusId", "buildingId", "floorId", "scope", "category"].every(k => !q.get(k) || q.get(k) === "ALL" || a[k] === q.get(k)));
}

export function dashboardSummary(s: DemoState, periodId: string, q = new URLSearchParams()): Row {
  const rows = periodRows(s, periodId, q);
  const computed = rows.filter(a => a.status === "CALCULATED" && a.calculations?.length);
  const totalKg = sumKg(computed);
  const byScope = (scope: string) => sumKg(computed.filter(a => a.scope === scope));
  const categories = [...new Set(computed.map(a => a.category))].map(category => {
    const subset = computed.filter(a => a.category === category);
    return { category, scope: subset[0]?.scope, tonnesCO2e: sumKg(subset) / 1000, trend: 0 };
  }).sort((a, b) => b.tonnesCO2e - a.tonnesCO2e);
  const months = [...new Set(computed.map(a => a.activityDate.slice(0, 7)))].sort();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const completedMonths = months.filter(m => m < currentMonth);
  const comparisonRows = computed.filter(a => completedMonths.includes(a.activityDate.slice(0, 7)));
  const baselinePeriod = s.collections["reporting-periods"].find(p => p.isBaseline);
  // Compare only corresponding months, not a half-year against a full year.
  const baselineRows = baselinePeriod && baselinePeriod.id !== periodId
    ? periodRows(s, baselinePeriod.id, q).filter(a => completedMonths.some(m => m.slice(5) === a.activityDate.slice(5, 7))) : [];
  const baselineKg = sumKg(baselineRows);
  const comparisonKg = sumKg(comparisonRows);
  const reduction = baselineKg ? round((baselineKg - comparisonKg) / baselineKg * 100, 1) : 0;
  const trends = months.map(month => {
    const items = computed.filter(a => a.activityDate.startsWith(month));
    return { month: `${month}-01`, totalKg: sumKg(items), scope1Kg: sumKg(items.filter(a => a.scope === "SCOPE_1")), scope2Kg: sumKg(items.filter(a => a.scope === "SCOPE_2")), scope3Kg: sumKg(items.filter(a => a.scope === "SCOPE_3")) };
  });
  const statusCount = (status: string) => rows.filter(a => a.status === status).length;
  const activityStats = { total: rows.length, draft: statusCount("DRAFT"), submitted: statusCount("SUBMITTED"), underReview: statusCount("UNDER_REVIEW"), needsReview: statusCount("UNDER_REVIEW"), verified: statusCount("VERIFIED"), rejected: statusCount("REJECTED"), calculated: statusCount("CALCULATED"), pending: rows.filter(a => ["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(a.status)).length, verifiedTotal: rows.filter(a => ["VERIFIED", "CALCULATED"].includes(a.status)).length,
    invoiceBackend: computed.filter(a => a.calculations[0].origin === "INVOICE_BACKEND").length, illustrative: computed.filter(a => a.calculations[0].origin !== "INVOICE_BACKEND").length };
  const groups = categories.map(c => {
    const prior = sumKg(baselineRows.filter(a => a.category === c.category)) / 1000;
    const comparison = sumKg(comparisonRows.filter(a => a.category === c.category)) / 1000;
    return { key: c.category, name: c.category.replaceAll("_", " ").toLowerCase(), description: "Calculated activity by building", icon: c.scope === "SCOPE_2" ? "building" : "factory", value: c.tonnesCO2e, share: totalKg ? c.tonnesCO2e * 1000 / totalKg : 0, delta: prior ? round((comparison - prior) / prior * 100, 1) : 0,
      items: s.collections.buildings.map(b => ({ name: b.name, value: sumKg(computed.filter(a => a.category === c.category && a.buildingId === b.id)) / 1000, scope: c.scope === "SCOPE_1" ? "S1" : c.scope === "SCOPE_2" ? "S2" : "S3" })).filter(b => b.value > 0),
      monthly: trends.map(t => ({ month: new Date(t.month).toLocaleString("en", { month: "short", timeZone: "UTC" }), value: sumKg(computed.filter(a => a.category === c.category && a.activityDate.startsWith(t.month.slice(0, 7)))) / 1000 })) };
  });
  return {
    overview: { totalEmissionsTonnes: totalKg / 1000, scope1Tonnes: byScope("SCOPE_1") / 1000, scope2Tonnes: byScope("SCOPE_2") / 1000, scope3Tonnes: byScope("SCOPE_3") / 1000, reductionPercentage: reduction, delta: -reduction, comparisonLabel: "completed months vs baseline", baselineKg, comparisonKg },
    trends, categories, groups, activityStats, dataMode: s.dataMode,
    scopeBreakdown: { scope1: { delta: 0 }, scope2: { delta: 0 }, scope3: { delta: 0 } },
    intensity: { tonnesPerStudent: round(totalKg / 1000 / Number(s.university.studentCount || 12000), 3), kgPerSqm: round(totalKg / Number(s.university.areaSqm || 90000), 2) },
    recentActivity: rows.slice().sort((a, b) => b.activityDate.localeCompare(a.activityDate)).slice(0, 6).map(a => ({ id: a.id, source: a.description || a.category, type: a.category.replaceAll("_", " "), scope: a.scope.replace("SCOPE_", "S"), value: a.calculations?.[0] ? `${round(a.calculations[0].co2eKg / 1000, 2)} t` : "Pending", status: a.status === "CALCULATED" ? "Synced" : a.status === "VERIFIED" ? "Processed" : "Needs review", updatedAt: a.updatedAt || a.createdAt })),
    targets: s.collections.targets.length ? [{ label: "Baseline months", value: baselineKg / 1000, unit: "tCO2e" }, ...s.collections.targets.map(t => ({ label: `${t.targetYear} target`, value: baselineKg / 1000 * (1 - t.reductionPct / 100), unit: "tCO2e" }))] : [],
  };
}

const normalizeUnit = (unit: string) => ({ litre: "L", liter: "L", litres: "L", liters: "L", l: "L", kwh: "kWh", kg: "kg", "m³": "m3", m3: "m3", km: "km", gj: "GJ" }[String(unit).trim().toLowerCase()] || String(unit).trim());
function validateActivity(s: DemoState, body: Row, periodId: string): Row {
  const period = assertEditable(s, periodId);
  if (body.physicalEntityId) {
    const asset = s.collections.assets.find(a => a.id === body.physicalEntityId);
    const locationId = asset?.locationId || body.physicalEntityId;
    const floor = s.collections.floors.find(f => f.id === locationId);
    const building = s.collections.buildings.find(b => b.id === (floor?.buildingId || locationId));
    const campus = s.collections.campuses.find(c => c.id === (building?.campusId || floor?.campusId || locationId));
    if (!campus) throw new DemoError("Select a location in the university hierarchy.");
    body = { ...body, campusId: body.campusId || campus.id, buildingId: body.buildingId || building?.id, floorId: body.floorId || floor?.id, assetId: body.assetId || asset?.id };
  }
  const isInvoice = Boolean(body.invoiceDocumentId);
  if (isInvoice) {
    const doc = find(s.collections.documents, body.invoiceDocumentId);
    if (!doc.invoiceResult || !doc.invoiceResult.items.some((r: InvoiceLine) => r.id === body.invoiceLineId)) throw new DemoError("Invoice source line was not found.");
    if (!INVOICE_CATEGORIES.some(c => c[0] === body.category) || !["SCOPE_1", "SCOPE_2", "SCOPE_3"].includes(body.scope)) throw new DemoError("Select an invoice category and scope.");
  }
  const factor = s.collections["emission-factors"].find(f => f.category === body.category && f.isActive);
  if (!factor && !isInvoice) throw new DemoError("Choose a supported activity category.");
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new DemoError("Quantity must be a positive number.");
  const date = new Date(body.activityDate);
  if (!Number.isFinite(date.getTime())) throw new DemoError("Enter a valid activity date.");
  if (date < new Date(period.startDate) || date > new Date(period.endDate)) throw new DemoError("Activity date must be within the selected reporting period.");
  const unit = isInvoice ? invoiceUnit(body.unit) : normalizeUnit(body.unit || factor!.unit);
  if (!unit) throw new DemoError("Enter the activity unit from the invoice.");
  if (!isInvoice && unit !== factor!.unit) throw new DemoError(`Use ${factor!.unit} for ${factor!.name}. Unit conversion requires the live calculation service.`);
  if (body.campusId) find(s.collections.campuses, body.campusId);
  if (body.buildingId) {
    const b = find(s.collections.buildings, body.buildingId);
    if (body.campusId && b.campusId !== body.campusId) throw new DemoError("Building must belong to the selected campus.");
  }
  if (body.floorId) {
    const f = find(s.collections.floors, body.floorId);
    if (body.buildingId && f.buildingId !== body.buildingId) throw new DemoError("Floor must belong to the selected building.");
  }
  if (!isInvoice && body.scope && body.scope !== factor!.scope) throw new DemoError("Scope must match the selected activity category.");
  return { ...body, quantity, unit, scope: isInvoice ? body.scope : factor!.scope, reportingPeriodId: periodId, universityId: DEMO_ORG, activityDate: date.toISOString() };
}

function invoiceCalculation(s: DemoState, a: Row): Row {
  const doc = find(s.collections.documents, a.invoiceDocumentId);
  const invoice = doc.invoiceResult;
  const line = invoice?.items.find((r: InvoiceLine) => r.id === a.invoiceLineId) as InvoiceLine | undefined;
  if (!line || !backendCalculationMatches(line, a as any) || (invoice.invoiceYear && Number(a.activityDate.slice(0, 4)) !== invoice.invoiceYear)) throw new DemoError("This invoice line needs a new backend calculation: its quantity, unit, category or invoice year changed, or the backend returned no result. Re-upload a corrected invoice; no demo factor is substituted.", 409);
  const co2eKg = line.co2eKg!;
  return { id: `calc-${a.id}`, activityDataId: a.id, co2eKg, co2eTonnes: co2eKg / 1000, calculatedAt: new Date().toISOString(), origin: "INVOICE_BACKEND",
    emissionFactorId: line.activityId, emissionFactor: { factorValue: line.factorValue, factor: line.factorValue, source: line.factorSource, version: line.factorVersion, unit: line.factorUnit, name: line.factorName },
    factorValue: line.factorValue, factorUnit: line.factorUnit, factorName: line.factorName, factorSource: line.factorSource, factorDataset: line.factorDataset, factorVersion: line.factorVersion,
    formula: `Invoice backend returned ${co2eKg} kgCO2e for ${line.quantity} ${line.unit}.`, methodology: `Original invoice backend result (${line.sourceEngine || line.factorSource}); reviewed quantity and unit preserved.`,
    invoiceDocumentId: doc.id, invoiceLineId: line.id, country: invoice.country, region: invoice.region, extractionProvider: invoice.provider, converted: line.converted };
}

function addActivity(s: DemoState, body: Row, periodId: string): Row {
  const data = validateActivity(s, body, periodId);
  if (!["DRAFT", "SUBMITTED"].includes(data.status || "DRAFT")) throw new DemoError("New activities must start as a draft or submission.");
  const a: Row = { ...data, id: newId("activity"), demoSample: false, status: data.status || "DRAFT", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), calculations: [] };
  delete a.calculateOnSave;
  if (body.calculateOnSave === true && a.status === "SUBMITTED") {
    try {
      a.calculations = [a.invoiceDocumentId ? invoiceCalculation(s, a)
        : makeCalculation(a, s.collections["emission-factors"].find(f => f.category === a.category && f.isActive)!)];
      a.status = "CALCULATED";
    } catch (error) {
      // Reviewed source data is still saved when an invoice cannot be calculated.
      if (!(error instanceof DemoError) || error.status !== 409) throw error;
      a.calculationError = error.message;
    }
  }
  activateUserData(s);
  s.collections["activity-data"].unshift(a);
  audit(s, "CREATE", "ACTIVITY", `${a.category}: ${a.quantity} ${a.unit}`);
  return a;
}

function decorateActivity(s: DemoState, a: Row) {
  const doc = s.collections.documents.find(d => d.id === a.documentId);
  const source = doc?.invoiceResult?.items.find((line: InvoiceLine) => line.id === a.invoiceLineId);
  const document = doc && source ? { ...doc, extractedData: { category: source.category, scope: source.scope, quantity: source.quantity, unit: source.unit, activityDate: doc.invoiceResult.invoiceDate } } : doc;
  return { ...a, document, campus: s.collections.campuses.find(c => c.id === a.campusId), building: s.collections.buildings.find(b => b.id === a.buildingId), floor: s.collections.floors.find(f => f.id === a.floorId), asset: s.collections.assets.find(r => r.id === a.assetId), reportingPeriod: s.collections["reporting-periods"].find(p => p.id === a.reportingPeriodId) };
}

function decorateDocument(s: DemoState, doc: Row): Row {
  return { ...doc, linkedActivities: s.collections["activity-data"].filter(a => a.invoiceDocumentId === doc.id).map(a => ({ ...a,
    campus: s.collections.campuses.find(c => c.id === a.campusId), building: s.collections.buildings.find(b => b.id === a.buildingId), floor: s.collections.floors.find(f => f.id === a.floorId) })) };
}

async function previewFile(s: DemoState, file: File, periodId: string) {
  assertEditable(s, periodId);
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new DemoError("Choose a CSV, XLSX or XLS file.");
  if (file.size > 10 * 1024 * 1024) throw new DemoError("Maximum import size is 10 MB.");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const valid: Row[] = [], invalid: Row[] = [];
  const alias: Record<string, string> = {
    category: "category", activitycategory: "category", activitytype: "category", type: "category", fuel: "category", source: "category",
    quantity: "quantity", qty: "quantity", consumption: "quantity", consumptionkwh: "quantity", fuelconsumption: "quantity", amount: "quantity", value: "quantity",
    unit: "unit", units: "unit", uom: "unit", scope: "scope",
    activitydate: "activityDate", date: "activityDate", invoicedate: "activityDate", billdate: "activityDate", consumptiondate: "activityDate",
    description: "description", notes: "description", details: "description",
    campus: "campusId", campusname: "campusId", campusid: "campusId", building: "buildingId", buildingname: "buildingId", buildingid: "buildingId",
  };
  const categories: Record<string, string> = { electricity: "PURCHASED_ELECTRICITY", gridpower: "PURCHASED_ELECTRICITY", grid: "PURCHASED_ELECTRICITY", power: "PURCHASED_ELECTRICITY", diesel: "DIESEL", petrol: "PETROL", gasoline: "PETROL", lpg: "LPG", naturalgas: "NATURAL_GAS", png: "NATURAL_GAS", refrigerant: "REFRIGERANT", fleettransport: "OWNED_VEHICLE", steam: "PURCHASED_STEAM", water: "WATER", businesstravel: "BUSINESS_TRAVEL" };
  const clean = (x: any) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const sheet of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheet], { header: 1, defval: "", blankrows: true });
    const header = matrix.findIndex((row, i) => i < 25 && row.some(c => alias[clean(c)] === "quantity") && row.some(c => alias[clean(c)] === "activityDate"));
    if (header < 0) {
      if (matrix.some(row => row.some(c => String(c).trim()))) invalid.push({ row: 1, rowNumber: 1, sheet, error: "No header found. Include Category, Quantity, Unit and Date columns.", errors: ["Header row missing"], data: {} });
      continue;
    }
    const keys = matrix[header].map(c => alias[clean(c)] || "");
    for (let n = header + 1; n < matrix.length; n++) {
      const cells = matrix[n];
      if (!cells.some(c => String(c).trim())) continue;
      const data: Row = { description: `Imported from ${file.name} / ${sheet}`, inputSource: "EXCEL", status: "SUBMITTED" };
      keys.forEach((key, i) => { if (key) data[key] = cells[i]; });
      data.category = categories[clean(data.category)] || String(data.category || "").trim().toUpperCase().replace(/\s+/g, "_");
      if (!data.category && matrix[header].some(c => clean(c) === "consumptionkwh")) data.category = "PURCHASED_ELECTRICITY";
      data.quantity = Number(String(data.quantity).replaceAll(",", "").trim());
      if (data.activityDate instanceof Date) data.activityDate = data.activityDate.toISOString();
      else if (typeof data.activityDate === "number") {
        const date = XLSX.SSF.parse_date_code(data.activityDate);
        data.activityDate = date ? new Date(Date.UTC(date.y, date.m - 1, date.d)).toISOString() : "";
      } else {
        const raw = String(data.activityDate).trim();
        const indian = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        data.activityDate = indian ? `${indian[3]}-${indian[2].padStart(2, "0")}-${indian[1].padStart(2, "0")}` : raw;
      }
      for (const [field, collection] of [["campusId", "campuses"], ["buildingId", "buildings"]]) {
        if (data[field]) data[field] = s.collections[collection].find(r => [r.id, r.name, r.code].some(v => clean(v) === clean(data[field])))?.id || String(data[field]);
      }
      if (data.scope) data.scope = String(data.scope).toUpperCase().replace(/\s+/g, "_").replace(/^S([123])$/, "SCOPE_$1");
      try {
        const row = validateActivity(s, data, periodId);
        const duplicate = valid.some(v => v.category === row.category && v.quantity === row.quantity && v.activityDate === row.activityDate && v.buildingId === row.buildingId);
        if (duplicate) throw new DemoError("Duplicate row within this upload.");
        valid.push({ ...row, rowNumber: n + 1, sheet });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Invalid row";
        invalid.push({ row: n + 1, rowNumber: n + 1, sheet, error, errors: [error], data });
      }
    }
  }
  const jobId = newId("import");
  s.collections["import-jobs"] ??= [];
  s.collections["import-jobs"].push({ id: jobId, periodId, fileName: file.name, validRows: valid, committed: false });
  return { jobId, validRows: valid, invalidRows: invalid, valid: valid.map(d => ({ row: d.rowNumber, data: d })), invalid, total: valid.length + invalid.length };
}

async function reportPdf(s: DemoState, report: Row) {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const response = await fetch("/fonts/DejaVuSans.ttf");
  if (!response.ok) throw new DemoError("Report font could not be loaded. Retry the download.");
  const font = await pdf.embedFont(await response.arrayBuffer(), { subset: true });
  const bold = font;
  let page = pdf.addPage([595, 842]);
  let y = 782;
  const line = (text: string, size = 11, strong = false) => {
    const words = text.replace(/[^\x20-\x7E]/g, "-").split(" "); let current = "";
    const draw = (value: string) => {
      if (y < 55 + size) { page = pdf.addPage([595, 842]); y = 782; }
      page.drawText(value, { x: 44, y, size, font: strong ? bold : font, color: rgb(0.07, 0.15, 0.18) }); y -= size + 12;
    };
    for (const word of words) {
      if (current && font.widthOfTextAtSize(`${current} ${word}`, size) > 507) { draw(current); current = ""; }
      current = current ? `${current} ${word}` : word;
    }
    if (current) draw(current);
  };
  const summary = report.snapshot || dashboardSummary(s, report.reportingPeriodId);
  line("CarbonSynq | University Carbon Report", 19, true);
  line("DEMO - ILLUSTRATIVE DATA - NOT AN OFFICIAL DISCLOSURE", 10, true);
  line(report.universityName || s.university.name, 17, true);
  line(`Reporting period: ${report.periodName || report.reportingPeriodId}`);
  line(`Generated: ${new Date(report.createdAt).toISOString().slice(0, 10)}`);
  line(`Report ID: ${report.id}`, 9);
  y -= 12;
  line("Calculated and reviewed inventory", 14, true);
  line(`Total: ${summary.overview.totalEmissionsTonnes.toFixed(3)} tCO2e`, 17, true);
  for (const [n, key] of [[1, "scope1Tonnes"], [2, "scope2Tonnes"], [3, "scope3Tonnes"]]) line(`Scope ${n}: ${Number(summary.overview[key]).toFixed(3)} tCO2e`);
  y -= 12;
  line("Sources", 14, true);
  for (const c of summary.categories) line(`${c.category.replaceAll("_", " ")}: ${c.tonnesCO2e.toFixed(3)} tCO2e`);
  y -= 12;
  line(`Calculated records: ${summary.activityStats.calculated}`);
  line(`Invoice backend records: ${summary.activityStats.invoiceBackend || 0}; illustrative records: ${summary.activityStats.illustrative ?? summary.activityStats.calculated}`, 9);
  line(`Pending / excluded from totals: ${summary.activityStats.total - summary.activityStats.calculated}`);
  line(`Change for completed months vs baseline: ${summary.overview.delta.toFixed(1)}%`);
  y -= 12;
  line("Method: invoice rows preserve the backend result; sample/manual rows use demo factors.", 9);
  line(summary.dataMode === "USER" ? "User-entered/imported activity data only; sample ledger excluded." : "Sample activity ledger; first saved activity switches to user data.", 9);
  line("Check geography, year, units and source before preparing an actual inventory.", 9);
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}

export function exportDemoReport(id: string, format: "json" | "csv" | "html") {
  const s = getDemoState();
  const report = find([...s.collections.reports, ...s.collections["university/reports"]], id);
  const summary = report.snapshot || dashboardSummary(s, report.reportingPeriodId || "period-2026");
  const escape = (v: any) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const dataset = summary.dataMode === "USER" ? "USER_ACTIVITY" : "DEMO";
  const content = format === "csv" ? "category,scope,tonnesCO2e,dataset\n" + summary.categories.map((c: Row) => `${c.category},${c.scope},${c.tonnesCO2e},${dataset}`).join("\n")
    : format === "html" ? `<!doctype html><html><head><meta charset="utf-8"><title>CarbonSynq Demo Report</title></head><body><h1>${escape(report.universityName || s.university.name)}</h1><p>${dataset} · Manual/Excel use illustrative factors; invoices preserve backend results.</p><p>Total: ${summary.overview.totalEmissionsTonnes.toFixed(3)} tCO2e</p><pre>${escape(JSON.stringify(summary, null, 2))}</pre></body></html>`
    : JSON.stringify({ ...report, demo: true, summary }, null, 2);
  return URL.createObjectURL(new Blob([content], { type: format === "html" ? "text/html" : format === "csv" ? "text/csv" : "application/json" }));
}

export async function demoFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  try {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(endpoint, "http://demo.invalid");
    const path = url.pathname.replace(/^\//, "");
    const q = url.searchParams;
    const method = (options.method || "GET").toUpperCase();
    const s = getDemoState();
    const c = s.collections;
    const body: Row = typeof options.body === "string" ? JSON.parse(options.body || "{}") : {};
    if (path === "auth/login") {
      if (body.email?.toLowerCase() !== DEMO_EMAIL || body.password !== DEMO_PASSWORD) throw new DemoError(`Use ${DEMO_EMAIL} and ${DEMO_PASSWORD} to access the demo.`, 401);
      localStorage.setItem("carbonsynq_org_type", "university");
      return ok({ token: DEMO_TOKEN, expiresInSeconds: 86400, user: { ...c["operations/users"][0], tenantId: DEMO_ORG, organisationId: DEMO_ORG } });
    }
    if (path.startsWith("account/")) throw new DemoError("Password recovery needs the live account service. Use the demo sign-in button.", 400);
    if (localStorage.getItem("token") !== DEMO_TOKEN) throw new DemoError("Sign in to the demo workspace first.", 401);
    if (path === "auth/logout") return ok({});
    if (path === "auth/password") throw new DemoError("The demo uses a fixed sample account. Password changes require the live account service.");
    const periodId = selectedPeriod(s, q);
    const mutate = (data: any, status = 200, extra: Row = {}) => { saveDemoState(s); return ok(data, status, extra); };
    if (path === "invoices/received" && method === "POST") {
      const invoice = body.invoice;
      if (!invoice?.requestId || !Array.isArray(invoice.items) || invoice.items.length > 200) throw new DemoError("Invalid invoice backend response.");
      const existing = c.documents.find(d => d.invoiceResult?.requestId === invoice.requestId);
      if (existing) return ok(existing);
      const doc: Row = { id: newId("invoice"), fileName: invoice.fileName, fileSize: body.fileSize, mimeType: body.mimeType, documentType: "INVOICE", status: "PROCESSED", ocrStatus: "COMPLETED", createdAt: invoice.receivedAt,
        fileUrl: "", invoiceResult: invoice, importedLines: {}, source: "INVOICE_BACKEND", demoSample: false };
      c.documents.unshift(doc); audit(s, "INVOICE_EXTRACT", "DOCUMENT", `${invoice.fileName}: ${invoice.items.length} lines (${invoice.provider})`);
      return mutate(doc, 201);
    }
    if (/^invoices\/[^/]+\/import$/.test(path) && method === "POST") {
      const doc = find(c.documents, path.split("/")[1]);
      const pid = body.reportingPeriodId || periodId;
      assertEditable(s, pid);
      if (!doc.invoiceResult || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > 200) throw new DemoError("Select invoice lines to save.");
      const ids = body.rows.map((r: Row) => r.lineId);
      if (new Set(ids).size !== ids.length || ids.some((id: string) => doc.importedLines?.[id])) throw new DemoError("An invoice line has already been saved or selected twice.", 409);
      // Validate the whole selection before creating anything: a bad row cannot
      // leave an invoice partially imported when the user retries.
      const inputs = body.rows.map((row: Row) => {
        if (!row.campusId) throw new DemoError("Select a campus for every invoice row.");
        return validateActivity(s, { category: row.category, scope: row.scope, quantity: row.quantity, unit: row.unit, activityDate: row.activityDate, description: row.description,
          campusId: row.campusId, buildingId: row.buildingId, floorId: row.floorId, invoiceDocumentId: doc.id, invoiceLineId: row.lineId, documentId: doc.id, inputSource: "INVOICE", status: "SUBMITTED", calculateOnSave: body.calculateOnSave === true }, pid);
      });
      const activities = inputs.map((input: Row) => addActivity(s, input, pid));
      doc.importedLines ||= {};
      activities.forEach((a: Row) => { doc.importedLines[a.invoiceLineId] = a.id; });
      doc.status = doc.invoiceResult.items.every((r: InvoiceLine) => doc.importedLines[r.id]) ? "ACTIVITY_CREATED" : "PROCESSED";
      audit(s, "INVOICE_IMPORT", "DOCUMENT", `${doc.fileName}: ${activities.length} saved rows`);
      return mutate({ activities, document: decorateDocument(s, doc), imported: activities.length }, 201);
    }
    if (method === "GET" && path === "documents") return ok(c.documents.map(doc => decorateDocument(s, doc)));
    if (method === "GET" && /^documents\/[^/]+$/.test(path)) return ok(decorateDocument(s, find(c.documents, path.split("/")[1])));
    if (path === "onboarding/hierarchy") return ok({ campuses: c.campuses.map(campus => ({ ...campus, buildings: c.buildings.filter(b => b.campusId === campus.id).map(b => ({ ...b, floors: c.floors.filter(f => f.buildingId === b.id) })) })) });
    if (path === "onboarding") {
      if (method === "GET") { if (!s.onboarding) throw new DemoError("Not onboarded", 404); return ok(s.onboarding); }
      if (method === "POST" && s.onboarding) throw new DemoError("Onboarding already exists", 409);
      if (body.university && !String(body.university.legalName || "").trim()) throw new DemoError("Enter your legal university name.");
      s.onboarding = { ...body, id: "demo-onboarding", organisationId: DEMO_ORG, createdAt: s.onboarding?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      s.university.name = body.university?.brandName || body.university?.legalName || body.company?.brandName || body.company?.legalName || s.university.name;
      s.university.studentCount = Number(body.university?.studentEnrollment) || s.university.studentCount;
      s.university.staffCount = Number(body.university?.staffCount) || s.university.staffCount;
      if (body.physicalHierarchy?.campuses?.length) {
        const campuses: Row[] = [], buildings: Row[] = [], floors: Row[] = [];
        body.physicalHierarchy.campuses.forEach((campus: Row, ci: number) => {
          const id = campus.id || c.campuses[ci]?.id || newId("campus");
          campuses.push({ ...campus, id, universityId: DEMO_ORG, buildings: undefined });
          (campus.buildings || []).forEach((building: Row, bi: number) => {
            const bid = building.id || c.buildings.filter(b => b.campusId === id)[bi]?.id || newId("building");
            buildings.push({ ...building, id: bid, campusId: id, floors: undefined });
            (building.floors || []).forEach((floor: Row, fi: number) => floors.push({ ...floor, id: floor.id || `${bid}-floor-${fi}`, buildingId: bid, campusId: id }));
          });
        });
        c.campuses = campuses; c.buildings = buildings; c.floors = floors;
      }
      s.onboarding.physicalHierarchy = { campuses: c.campuses.map(campus => ({ ...campus, buildings: c.buildings.filter(b => b.campusId === campus.id).map(building => ({ ...building, floors: c.floors.filter(f => f.buildingId === building.id) })) })) };
      c.assets = c.assets.filter(asset => !asset.demoSample || c.buildings.some(b => b.id === asset.buildingId));
      s.onboardingCompleted = true;
      audit(s, "SAVE", "ONBOARDING", "University profile saved in demo workspace");
      return mutate(s.onboarding, method === "POST" ? 201 : 200);
    }
    if (path.startsWith("dashboard/")) {
      const summary = dashboardSummary(s, periodId, q);
      const key = path.split("/")[1];
      const map: Row = { overview: summary.overview, "scope-breakdown": summary.scopeBreakdown, categories: summary.categories, "top-sources": summary.categories, trends: summary.trends, buildings: c.buildings, floors: c.floors, "baseline-comparison": summary.overview, intensity: summary.intensity };
      return ok(key === "summary" ? summary : map[key] ?? summary);
    }
    if (path === "activity-data/import/template") return new Response("Category,Quantity,Unit,Date,Campus,Building,Description\nElectricity,12500,kWh,2026-10-01,Main Campus,Academic Block,Sample meter entry\nDiesel,650,L,2026-10-02,Research Campus,Research Laboratories,Sample fuel entry\n", { headers: { "Content-Type": "text/csv" } });
    if ((path.includes("imports/") && ["preview", "commit"].some(a => path.endsWith(a))) || path === "activity-data/import/preview") {
      const fd = options.body as FormData;
      const file = fd.get("file") as File;
      if (!file) throw new DemoError("No file selected.");
      const pid = String(fd.get("reportingPeriodId") || periodId);
      const preview = await previewFile(s, file, pid);
      if (path.endsWith("commit")) {
        if (!preview.validRows.length) throw new DemoError("No valid rows to import.");
        preview.validRows.forEach(r => addActivity(s, r, pid));
        find(c["import-jobs"], preview.jobId).committed = true;
        return mutate({ imported: preview.validRows.length });
      }
      return mutate(preview);
    }
    if (path === "activity-data/import/confirm") {
      const job = find(c["import-jobs"] || [], body.jobId);
      if (job.committed) throw new DemoError("This file has already been imported.", 409);
      if (job.periodId !== body.reportingPeriodId) throw new DemoError("Import preview belongs to another reporting period.");
      assertEditable(s, job.periodId);
      if (!job.validRows.length) throw new DemoError("No valid rows to import.");
      const inputs = job.validRows.map((r: Row) => validateActivity(s, r, job.periodId));
      inputs.forEach((r: Row) => addActivity(s, { ...r, ...(body.calculateOnSave ? { status: "SUBMITTED", calculateOnSave: true } : {}) }, job.periodId));
      job.committed = true;
      return mutate({ imported: job.validRows.length }, 200, { importedRows: job.validRows.length });
    }
    if (path === "activity-data" || path === "activity-data/review") {
      if (method === "GET") return ok(periodRows(s, periodId, q).filter(a => path !== "activity-data/review" || ["SUBMITTED", "UNDER_REVIEW"].includes(a.status)).map(a => decorateActivity(s, a)));
      return mutate(addActivity(s, body, body.reportingPeriodId || periodId), 201);
    }
    if (path.startsWith("activity-data/")) {
      const [, id, action] = path.split("/");
      const a = find(c["activity-data"], id);
      if (method === "GET") return ok(decorateActivity(s, a));
      assertEditable(s, a.reportingPeriodId);
      if (method === "DELETE") {
        if (!["DRAFT", "REJECTED"].includes(a.status)) throw new DemoError("Only draft or rejected activities can be deleted.", 409);
        c["activity-data"] = c["activity-data"].filter(r => r.id !== id);
        if (a.invoiceDocumentId) {
          const doc = find(c.documents, a.invoiceDocumentId);
          delete doc.importedLines?.[a.invoiceLineId]; doc.status = "PROCESSED";
        }
        audit(s, "DELETE", "ACTIVITY", id); return mutate({ id });
      }
      if (method === "PATCH") {
        if (!["DRAFT", "REJECTED", "UNDER_REVIEW"].includes(a.status)) throw new DemoError("Reset this activity before editing it.", 409);
        Object.assign(a, validateActivity(s, { ...a, ...body }, a.reportingPeriodId), { calculations: [] });
      } else {
        const transitions: Record<string, { from: string[]; to: string }> = {
          submit: { from: ["DRAFT", "REJECTED", "SUBMITTED"], to: "SUBMITTED" }, "start-review": { from: ["SUBMITTED"], to: "UNDER_REVIEW" }, verify: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "VERIFIED" }, reject: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "REJECTED" }, reset: { from: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "VERIFIED", "CALCULATED", "REJECTED"], to: "DRAFT" },
        };
        const transition = transitions[action];
        if (!transition || !transition.from.includes(a.status)) throw new DemoError("This workflow transition is not available from the current status.", 409);
        if (action === "reject" && !String(body.reason || "").trim()) throw new DemoError("A rejection reason is required.");
        a.status = transition.to;
        if (action === "reject") a.rejectionReason = body.reason;
        if (action === "reset") a.calculations = [];
      }
      a.updatedAt = new Date().toISOString(); audit(s, action || "UPDATE", "ACTIVITY", id);
      return mutate(decorateActivity(s, a));
    }
    if (path.startsWith("calculations/activity/") || path === "emissions/calculate") {
      const id = path.startsWith("calculations/activity/") ? path.split("/")[2] : body.activity_data_id || body.activityId;
      const a = find(c["activity-data"], id);
      assertEditable(s, a.reportingPeriodId);
      if (!["VERIFIED", "CALCULATED"].includes(a.status)) throw new DemoError("Verify the activity before calculating emissions.", 409);
      if (a.invoiceDocumentId) {
        const calc = invoiceCalculation(s, a); a.calculations = [calc]; a.status = "CALCULATED";
        audit(s, "CALCULATE", "ACTIVITY", `${id}: ${calc.co2eKg} kgCO2e from invoice backend`);
        return mutate({ ...calc, emissionFactor: calc.factorValue });
      }
      const factor = c["emission-factors"].find(f => f.category === a.category && f.unit === normalizeUnit(a.unit) && f.isActive);
      if (!factor) throw new DemoError("No matching active demo factor. Check category and unit.");
      const calc = makeCalculation(a, factor); a.calculations = [calc]; a.status = "CALCULATED";
      audit(s, "CALCULATE", "ACTIVITY", `${id}: ${calc.co2eKg} kgCO2e`);
      return mutate({ ...calc, emissionFactor: factor.factor });
    }
    if (path === "documents/upload") {
      const fd = options.body instanceof FormData ? options.body : null;
      const file = (fd?.get("file") || options.body) as File;
      if (!file?.name || file.size > 20 * 1024 * 1024) throw new DemoError("Choose a document under 20 MB.");
      const sample = file.name === "sample-electricity-invoice.pdf";
      const doc = { id: newId("doc"), fileName: file.name, fileSize: file.size, mimeType: file.type, documentType: fd?.get("documentType") || "INVOICE", status: "UPLOADED", ocrStatus: "PENDING", createdAt: new Date().toISOString(), fileUrl: sample ? "/demo/sample-electricity-invoice.pdf" : "", demoSample: sample, extraction: null, extractedData: null };
      c.documents.unshift(doc); audit(s, "UPLOAD", "DOCUMENT", file.name);
      return mutate(doc, 201);
    }
    if (path.startsWith("documents/") && path.endsWith("create-activity")) {
      const doc = find(c.documents, path.split("/")[1]);
      const a = addActivity(s, { ...body, documentId: doc.id, inputSource: "INVOICE", status: "SUBMITTED" }, body.reportingPeriodId || periodId);
      doc.activityDataId = a.id; return mutate(a, 201);
    }
    if (path.endsWith("/ocr") && (path.startsWith("documents/") || path.startsWith("operations/documents/"))) {
      const doc = find(c.documents, path.split("/").at(-2)!);
      if (doc.invoiceResult) throw new DemoError("This invoice was already processed by the ERP backend. Open Invoice Upload to review its saved lines, or upload the original file again to run extraction.", 409);
      // Only the bundled, visibly marked sample is prefilled. Other files require manual review.
      const extraction = doc.demoSample ? { category: "PURCHASED_ELECTRICITY", scope: "SCOPE_2", quantity: 12500, unit: "kWh", activityDate: "2026-10-01", vendor: "Demo Electricity Supplier", invoiceNumber: "DEMO-ELEC-001", demo: true } : {};
      Object.assign(doc, { status: "PROCESSED", ocrStatus: "COMPLETED", extraction, extractedData: extraction, ocrNote: "Demo workflow: bundled sample fields only. Enter and verify other invoice values manually." });
      c["operations/ocr"].unshift({ id: newId("ocr"), documentId: doc.id, status: "COMPLETED", createdAt: new Date().toISOString(), demo: true });
      audit(s, "DEMO_REVIEW", "DOCUMENT", doc.fileName); return mutate(doc);
    }
    if (path.startsWith("reports")) {
      if (path === "reports/generate") {
        const pid = body.reportingPeriodId || periodId;
        const period = find(c["reporting-periods"], pid);
        const snapshot = dashboardSummary(s, pid);
        if (!snapshot.activityStats.calculated) throw new DemoError("Calculate at least one verified activity before generating a report.");
        const report = { id: newId("report"), status: "GENERATED", createdAt: new Date().toISOString(), reportingPeriodId: pid, universityName: s.university.name, periodName: period.name, snapshot, demo: true };
        c.reports.unshift(report); audit(s, "GENERATE", "REPORT", report.id); return mutate(report, 201);
      }
      if (path === "reports") return ok(c.reports);
      const [, id, action] = path.split("/");
      const report = find(c.reports, id);
      if (action === "download") return ok({}, 200, { url: URL.createObjectURL(await reportPdf(s, report)) });
      if (action === "generate-pdf") { report.status = "GENERATED"; return mutate(report); }
      return ok(report);
    }
    if (path === "data-quality/metrics") {
      const rows = periodRows(s, periodId, q), summary = dashboardSummary(s, periodId, q).activityStats;
      const total = rows.length, verified = summary.verifiedTotal, calculated = summary.calculated, withDocuments = rows.filter(a => a.documentId).length;
      const documentRate = total ? round(withDocuments / total * 100, 1) : 0;
      return ok({ qualityScore: total ? round((verified / total * 40) + (calculated / total * 30) + (withDocuments / total * 20) + 10, 1) : 0, summary,
        coverage: { verification: { verified, total, rate: total ? round(verified / total * 100, 1) : 0 }, calculation: { calculated, verified, rate: verified ? round(calculated / verified * 100, 1) : 0 }, document: { withDocument: withDocuments, total, rate: documentRate } },
        issues: [{ key: "unverified", label: "Activities awaiting verification", count: total - verified - summary.rejected }, { key: "uncalculated", label: "Verified activities awaiting calculation", count: verified - calculated }].filter(i => i.count > 0),
        totalActivities: total, verifiedCount: verified, calculatedCount: calculated, documentLinkedCount: withDocuments, duplicateCount: 0, missingDocuments: total - withDocuments });
    }
    if (path === "notifications/unread-count") return ok({ count: c.notifications.filter(n => !n.isRead).length });
    if (path === "notifications/read-all") { c.notifications.forEach(n => n.isRead = true); return mutate({}); }
    if (/^notifications\/[^/]+\/read$/.test(path)) { const n = find(c.notifications, path.split("/")[1]); n.isRead = true; return mutate(n); }
    if (path === "recommendations/generate") return ok(c.recommendations);
    if (path.startsWith("universities")) {
      if (method === "GET") return ok(path === "universities" ? [s.university] : s.university);
      Object.assign(s.university, body); if (s.onboarding?.university && body.name) s.onboarding.university.brandName = body.name;
      audit(s, "UPDATE", "UNIVERSITY", s.university.name); return mutate(s.university);
    }
    if (/^reporting-periods\/[^/]+\//.test(path)) {
      const [, id, action] = path.split("/"); const period = find(c["reporting-periods"], id);
      if (action === "open") period.status = "OPEN";
      else if (action === "lock") period.status = "LOCKED";
      else if (action === "set-baseline") c["reporting-periods"].forEach(p => p.isBaseline = p.id === id);
      else throw new DemoError("Unknown period action", 404);
      audit(s, action.toUpperCase(), "REPORTING_PERIOD", period.name); return mutate(period);
    }
    if (/^baselines\/[^/]+\/comparison$/.test(path)) {
      const baseline = find(c.baselines, path.split("/")[1]);
      const current = dashboardSummary(s, periodId);
      const completed = new Date().toISOString().slice(0, 7);
      const months = current.trends.filter((t: Row) => t.month.slice(0, 7) < completed).map((t: Row) => t.month.slice(5, 7));
      const baselineRows = periodRows(s, baseline.reportingPeriodId).filter(a => months.includes(a.activityDate.slice(5, 7)));
      const currentRows = periodRows(s, periodId).filter(a => a.activityDate.slice(0, 7) < completed && months.includes(a.activityDate.slice(5, 7)));
      const baselineTonnes = sumKg(baselineRows) / 1000, currentTonnes = sumKg(currentRows) / 1000;
      return ok({ baseline: baselineTonnes, current: currentTonnes, reduction: baselineTonnes - currentTonnes, reductionPercent: baselineTonnes ? round((baselineTonnes - currentTonnes) / baselineTonnes * 100, 1) : 0,
        scopeData: ["SCOPE_1", "SCOPE_2", "SCOPE_3"].map(scope => { const b = sumKg(baselineRows.filter(a => a.scope === scope)) / 1000, v = sumKg(currentRows.filter(a => a.scope === scope)) / 1000; return { scope, baseline: b, current: v, change: b - v, changePercent: b ? (b - v) / b * 100 : 0 }; }),
        categoryData: current.categories.map((item: Row) => { const b = sumKg(baselineRows.filter(a => a.category === item.category)) / 1000, v = sumKg(currentRows.filter(a => a.category === item.category)) / 1000; return { category: item.category, baseline: b, current: v, change: b - v, changePercent: b ? (b - v) / b * 100 : 0 }; }) });
    }
    if (/^targets\/[^/]+\/progress$/.test(path)) {
      const t = find(c.targets, path.split("/")[1]); const summary = dashboardSummary(s, periodId);
      const baseline = find(c.baselines, t.baselineId || c.baselines[0]?.id);
      const months = summary.trends.filter((r: Row) => r.month.slice(0, 7) < new Date().toISOString().slice(0, 7)).map((r: Row) => r.month.slice(5, 7));
      const baselineKg = sumKg(periodRows(s, baseline.reportingPeriodId).filter(a => a.status === "CALCULATED" && months.includes(a.activityDate.slice(5, 7))));
      const currentKg = summary.overview.comparisonKg;
      const reductionPct = baselineKg ? (baselineKg - currentKg) / baselineKg * 100 : 0;
      return ok({ progressPercent: round(Math.max(0, Math.min(100, reductionPct / t.reductionPct * 100)), 1), currentCo2eKg: currentKg, targetCo2eKg: t.targetCo2eKg,
        baselineTCO2e: round(baselineKg / 1000), currentTCO2e: round(currentKg / 1000), requiredReductionTCO2e: round(baselineKg / 1000 * t.reductionPct / 100) });
    }
    if (path === "university/meta") return ok({ university: s.university, periods: c["reporting-periods"], campuses: c.campuses, demo: true });
    if (path === "university/overview") return ok(dashboardSummary(s, periodId));
    if (path === "university/inventory") return ok({ items: periodRows(s, periodId).filter(a => a.status === "CALCULATED").map(a => ({ ...a, value_tco2e: a.calculations[0].co2eKg / 1000, date: a.activityDate, status: "APPROVED" })), nextCursor: null });
    if (path === "university/knowledge/search") {
      const term = (q.get("term") || q.get("q") || "").toLowerCase();
      return ok({ items: [...periodRows(s, periodId).filter(a => ["VERIFIED", "CALCULATED"].includes(a.status)).map(a => ({ ...a, title: a.description, type: "ACTIVITY", value_tco2e: (a.calculations?.[0]?.co2eKg || 0) / 1000 })), ...c["emission-factors"].map(f => ({ ...f, title: f.name, type: "FACTOR" }))].filter(r => JSON.stringify(r).toLowerCase().includes(term)).slice(0, 40) });
    }
    if (path === "university/insights/query") {
      const summary = dashboardSummary(s, body.periodId || periodId);
      const question = String(body.question || "").toLowerCase();
      let answer = "This demo supports the suggested questions about sources, electricity, campuses and Scope 2. Choose one to inspect the sample inventory.";
      if (question.includes("top") || question.includes("source")) answer = `Top sources: ${summary.categories.slice(0, 3).map((r: Row) => `${r.category.replaceAll("_", " ").toLowerCase()} (${r.tonnesCO2e.toFixed(2)} tCO2e)`).join(", ")}.`;
      else if (question.includes("campus")) { const ranked = c.campuses.map(campus => ({ name: campus.name, total: sumKg(periodRows(s, periodId).filter(a => a.campusId === campus.id && a.status === "CALCULATED")) / 1000 })).sort((a, b) => b.total - a.total); answer = `${ranked[0]?.name || "No campus"} has the highest calculated footprint: ${ranked[0]?.total.toFixed(2) || 0} tCO2e.`; }
      else if (question.includes("percentage") || question.includes("electricity")) answer = `Electricity accounts for ${summary.overview.totalEmissionsTonnes ? (summary.overview.scope2Tonnes / summary.overview.totalEmissionsTonnes * 100).toFixed(1) : 0}% of the calculated sample footprint.`;
      else if (question.includes("scope 2") || question.includes("last year")) answer = `Scope 2 is ${summary.overview.scope2Tonnes.toFixed(2)} tCO2e. The combined footprint changed by ${summary.overview.delta.toFixed(1)}% against corresponding baseline months.`;
      return ok(`${answer} Demo analysis uses calculated records in the selected reporting period and illustrative factors.`);
    }
    if (path === "university/catalog") return ok({ items: c["emission-factors"] });
    if (path === "university/catalog/install") return ok({ installed: c["emission-factors"].length });
    if (path === "emission-factors/pending") return ok(c["activity-data"].filter(a => a.status === "VERIFIED"));
    if (path === "emission-factors/match") return ok(c["emission-factors"].find(f => f.category === body.category) || null);
    if (path.startsWith("documents/activity/")) return ok(c.documents.find(d => d.activityDataId === path.split("/")[2]) || null);
    // Shared collection handling for the remaining management screens.
    const aliases: Record<string, string> = { "university/periods": "reporting-periods", "university/campuses": "campuses", "university/targets": "targets", "university/factors": "emission-factors", "operations/documents": "documents" };
    const allKeys = [...Object.keys(c), ...Object.keys(aliases)].sort((a, b) => b.length - a.length);
    const key = allKeys.find(k => path === k || path.startsWith(k + "/"));
    if (!key) throw new DemoError("This action is not available in the demo. It requires the V2 service.", 404);
    const collection = aliases[key] || key;
    const parts = path.slice(key.length).split("/").filter(Boolean);
    const rows = c[collection], id = parts[0], action = parts[1];
    if (method === "GET") {
      if (id) return ok(find(rows, id));
      let result = rows;
      for (const filter of ["status", "scope", "category", "priority", "role"]) if (q.get(filter) && q.get(filter) !== "ALL") result = result.filter(r => r[filter] === q.get(filter));
      if (q.has("isRead")) result = result.filter(r => r.isRead === (q.get("isRead") === "true"));
      return ok(result);
    }
    if (!id) {
      let data: Row = { ...body };
      if (collection === "reporting-periods") {
        if (!data.startDate || !data.endDate || new Date(data.startDate) >= new Date(data.endDate)) throw new DemoError("The period end date must follow its start date.");
        if (c[collection].some(p => new Date(data.startDate) <= new Date(p.endDate) && new Date(data.endDate) >= new Date(p.startDate))) throw new DemoError("Reporting periods cannot overlap.", 409);
        data.status = "DRAFT"; data.isBaseline = false;
      }
      if (collection === "targets") {
        const baseline = find(c.baselines, body.baselineId || c.baselines[0]?.id);
        if (!(Number(body.reductionPct) > 0 && Number(body.reductionPct) <= 100)) throw new DemoError("Reduction percentage must be between 0 and 100.");
        data.targetCo2eKg = baseline.totalCo2eKg * (1 - Number(body.reductionPct) / 100);
        data.baselineId = baseline.id;
      }
      if (collection === "baselines") {
        const period = find(c["reporting-periods"], body.reportingPeriodId);
        const total = sumKg(periodRows(s, period.id).filter(a => a.status === "CALCULATED"));
        if (!total) throw new DemoError("Calculate activity emissions before creating a baseline.");
        data = { ...data, name: `${period.name} baseline`, reportingPeriod: period, baselineYear: Number(period.startDate.slice(0, 4)), totalKgCO2e: total, totalCo2eKg: total, totalEmissionsKg: total };
      }
      if (data.contactEmail) data.contact_email = data.contactEmail;
      if (data.productName) data.product_name = data.productName;
      // Demo users are records only; never persist passwords or send invitations.
      delete data.password; delete data.adminPassword;
      data = { ...data, id: newId(collection.split("/").at(-1)!), demoSample: false, status: data.status || "DRAFT", isActive: true, createdAt: new Date().toISOString(), created_at: new Date().toISOString() };
      if (collection === "operations/users") data.status = "ACTIVE";
      if (collection === "university/reports") data.snapshot = dashboardSummary(s, body.periodId || periodId);
      rows.unshift(data); audit(s, "CREATE", collection, data.name || data.title || data.id);
      return mutate(data, 201);
    }
    const row = find(rows, id);
    if (method === "DELETE") { c[collection] = rows.filter(r => r.id !== id); audit(s, "DELETE", collection, id); return mutate({ id }); }
    const actions: Record<string, string> = { approve: "APPROVED", reject: "REJECTED", submit: "SUBMITTED", lock: "LOCKED", close: "CLOSED", reopen: "DRAFT", revoke: "REVOKED", deactivate: "INACTIVE", waive: "WAIVED", invite: "INVITED" };
    if (action === "invite" || path === "operations/staff/invite") throw new DemoError("Demo invitations are not sent. Use the live staff service to send email.");
    if (action && actions[action]) {
      if (["reject", "waive"].includes(action) && !String(body.reason || "").trim()) throw new DemoError("A reason is required.");
      row.status = actions[action]; if (action === "deactivate") row.isActive = false;
    }
    const safe = { ...body }; delete safe.password; delete safe.adminPassword;
    Object.assign(row, safe, { demoSample: false, updatedAt: new Date().toISOString() });
    audit(s, action?.toUpperCase() || "UPDATE", collection, row.name || row.title || id);
    return mutate(row);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const message = e instanceof Error ? e.message : "Demo request failed";
    return Response.json({ success: false, error: message, message }, { status: e instanceof DemoError ? e.status : 400 });
  }
}
