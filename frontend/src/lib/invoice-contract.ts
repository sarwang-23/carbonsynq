/** Normalized contract for the supplied /api/erp/upload service. */
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;
export const INVOICE_MAX_FILES = 6;
export const INVOICE_CATEGORIES = [
  ["PURCHASED_ELECTRICITY", "Electricity", "SCOPE_2"], ["PURCHASED_STEAM", "Steam / heat", "SCOPE_2"],
  ["DIESEL", "Diesel", "SCOPE_1"], ["PETROL", "Petrol", "SCOPE_1"], ["LPG", "LPG", "SCOPE_1"],
  ["NATURAL_GAS", "Natural gas / PNG", "SCOPE_1"], ["CNG", "CNG", "SCOPE_1"], ["COAL", "Coal", "SCOPE_1"],
  ["FURNACE_OIL", "Furnace oil", "SCOPE_1"], ["BIOMASS", "Biomass", "SCOPE_1"],
  ["REFRIGERANT", "Refrigerant", "SCOPE_1"], ["OWNED_VEHICLE", "Owned fleet", "SCOPE_1"],
  ["WATER", "Water", "SCOPE_3"], ["BUSINESS_TRAVEL", "Business travel", "SCOPE_3"],
  ["OTHER_PURCHASES", "Other purchased goods / services", "SCOPE_3"],
] as const;

export type InvoiceLine = {
  id: string; name: string; sourceCategory: string; category: string; scope: string;
  quantity: number | ""; unit: string; backendStatus: string; issue: string;
  co2eKg: number | null; factorName: string; factorValue: number | null; factorUnit: string;
  factorSource: string; factorDataset: string; factorVersion: string; sourceEngine: string; activityId: string;
  converted: { value: number; unit: string } | null;
};
export type InvoiceResult = {
  requestId: string; fileName: string; receivedAt: string; country: string; region: string;
  provider: string; vendorName: string; invoiceNumber: string; invoiceDate: string;
  invoiceYear: number | null; currency: string; totalKg: number | null; items: InvoiceLine[]; warnings: string[];
};

const cleanText = (v: unknown, max = 500) => v == null || ["null", "not_available", "undefined"].includes(String(v).trim().toLowerCase()) ? "" : String(v).trim().slice(0, max);
const firstText = (...values: unknown[]) => values.map(v => cleanText(v)).find(Boolean) || "";
export function finiteInvoiceNumber(v: unknown): number | null {
  if (v == null || (typeof v !== "number" && typeof v !== "string") || String(v).trim() === "") return null;
  const n = Number(String(v).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}
export function invoiceUnit(v: unknown): string {
  const text = cleanText(v, 80);
  const aliases: Record<string, string> = { litre: "L", litres: "L", liter: "L", liters: "L", ltr: "L", l: "L", kwh: "kWh", "kilowatt hour": "kWh", kg: "kg", kilograms: "kg", "m³": "m3", m3: "m3", km: "km" };
  return aliases[text.toLowerCase()] || text;
}
export function invoiceDate(v: unknown): string {
  const text = cleanText(v);
  let iso = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) iso = text.slice(0, 10);
  else {
    const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const date = new Date(iso);
  return iso && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}
function categoryFor(raw: string): string {
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = { electricity: "PURCHASED_ELECTRICITY", electricity_bill: "PURCHASED_ELECTRICITY", grid_electricity: "PURCHASED_ELECTRICITY", power: "PURCHASED_ELECTRICITY", steam: "PURCHASED_STEAM", heat: "PURCHASED_STEAM", heating: "PURCHASED_STEAM", diesel: "DIESEL", petrol: "PETROL", gasoline: "PETROL", lpg: "LPG", natural_gas: "NATURAL_GAS", png: "NATURAL_GAS", cng: "CNG", coal: "COAL", furnace_oil: "FURNACE_OIL", biomass: "BIOMASS", refrigerant: "REFRIGERANT", water: "WATER", flight: "BUSINESS_TRAVEL", railway: "BUSINESS_TRAVEL", rail: "BUSINESS_TRAVEL", business_travel: "BUSINESS_TRAVEL", owned_vehicle: "OWNED_VEHICLE" };
  return aliases[key] || INVOICE_CATEGORIES.find(c => c[0] === key.toUpperCase())?.[0] || "OTHER_PURCHASES";
}
function kgFrom(value: unknown, unit: unknown): number | null {
  const number = finiteInvoiceNumber(value);
  if (number == null || number < 0) return null;
  const key = cleanText(unit).toLowerCase().replace(/\s+/g, "");
  if (["kg", "kgco2e", "kgco₂e", "kilogram", "kilograms"].includes(key)) return number;
  if (["t", "tonne", "tonnes", "ton", "tons", "tco2e"].includes(key)) return number * 1000;
  if (["g", "gco2e", "gram", "grams"].includes(key)) return number / 1000;
  return null;
}

export function normalizeInvoiceResponse(payload: any, fileName: string, requestId: string = crypto.randomUUID()): InvoiceResult {
  if (!payload || typeof payload !== "object" || payload.success === false) throw new Error(cleanText(payload?.message) || "Invoice processing failed.");
  const extraction = payload.extraction || {};
  const emission = payload.emission || {};
  const results = Array.isArray(emission.results) ? emission.results : [];
  if (results.length > 200) throw new Error("This invoice has more than 200 lines. Split it into smaller files before review.");
  const items: InvoiceLine[] = results.map((r: any, i: number) => {
    const item = r.item || {};
    const sourceCategory = firstText(r.category, item.category).slice(0, 100);
    const category = categoryFor(sourceCategory);
    const selected = r.selected_factor || {};
    const output = r.emission || {};
    const factorValue = finiteInvoiceNumber(r.factor_value) ?? finiteInvoiceNumber(selected.factor) ?? finiteInvoiceNumber(r.effective_factor?.value);
    const co2eKg = r.status === "calculated" ? kgFrom(finiteInvoiceNumber(r.co2e) ?? finiteInvoiceNumber(output.co2e) ?? finiteInvoiceNumber(output.co2e_total), firstText(r.co2e_unit, output.co2e_unit, emission.total_co2e_unit) || "kg") : null;
    const quantity = finiteInvoiceNumber(r.value) ?? finiteInvoiceNumber(item.quantity) ?? finiteInvoiceNumber(item.value);
    const issue = firstText(r.message, r.reason) || (r.status !== "calculated" ? "Backend requires manual review." : co2eKg == null ? "Backend emission quantity or unit is missing." : "");
    return {
      id: `${requestId}-line-${i}`, name: firstText(r.item_name, item.name, item.description) || `Invoice line ${i + 1}`,
      sourceCategory, category, scope: INVOICE_CATEGORIES.find(c => c[0] === category)?.[2] || "SCOPE_3",
      quantity: quantity ?? "", unit: invoiceUnit(firstText(r.unit, item.unit)), backendStatus: cleanText(r.status), issue,
      co2eKg, factorName: firstText(r.factor_name, selected.sourceLcaActivity) || "Invoice backend result", factorValue,
      factorUnit: firstText(r.factor_unit, selected.effectiveFactorUnit, selected.factorUnit, r.effective_factor?.unit).slice(0, 100),
      factorSource: firstText(r.source, r.factor_source, r.preferred_source, selected.source, emission.preferred_source, r.source_engine, emission.source_engine) || "Invoice backend",
      factorDataset: firstText(r.source_dataset, selected.sourceDataset),
      factorVersion: firstText(r.year, selected.factorYear, extraction.invoice_year).slice(0, 50),
      sourceEngine: firstText(r.source_engine, emission.source_engine).slice(0, 100), activityId: firstText(r.activity_id, r.factor_id, selected.factorId).slice(0, 150),
      converted: finiteInvoiceNumber(r.converted?.value) != null && cleanText(r.converted?.unit) ? { value: finiteInvoiceNumber(r.converted.value)!, unit: invoiceUnit(r.converted.unit) } : null,
    };
  });
  const date = invoiceDate(extraction.invoice_date);
  const warnings: string[] = [];
  if (!items.length) warnings.push(cleanText(payload.message) || "The backend returned no invoice lines. Add a row manually or upload a clearer document.");
  if (!date) warnings.push("Invoice date was not returned as a complete date. Enter the billing/activity date before saving.");
  if (items.some(r => r.issue)) warnings.push("Some lines need manual review. Missing or changed backend calculations remain uncalculated.");
  return {
    requestId, fileName, receivedAt: new Date().toISOString(), country: cleanText(payload.country?.country_name, 100), region: cleanText(payload.country?.region, 10),
    provider: cleanText(extraction.provider || payload.extraction_provider, 100) || "Invoice backend", vendorName: cleanText(extraction.vendor_name), invoiceNumber: cleanText(extraction.invoice_number, 150),
    invoiceDate: date, invoiceYear: finiteInvoiceNumber(extraction.invoice_year) || (date ? Number(date.slice(0, 4)) : null),
    currency: cleanText(extraction.currency, 10), totalKg: kgFrom(emission.total_co2e ?? payload.total_co2e, emission.total_co2e_unit || "kg"), items, warnings,
  };
}

export function backendCalculationMatches(line: InvoiceLine, values: { category: string; quantity: unknown; unit: string }): boolean {
  return line.co2eKg != null && line.co2eKg >= 0 && line.backendStatus === "calculated" && values.category === line.category && finiteInvoiceNumber(values.quantity) === line.quantity && invoiceUnit(values.unit).toLowerCase() === invoiceUnit(line.unit).toLowerCase();
}
