import { fetchAPI } from "./api";
import type { InvoiceResult } from "./invoice-contract";
import { DEMO_MODE } from "./demo-store";

export async function processInvoiceFile(file: File, signal?: AbortSignal) {
  const form = new FormData(); form.append("file", file);
  const token = localStorage.getItem("token");
  // This deliberately bypasses the demo transport: OCR runs in the supplied ERP backend.
  const response = await fetch("/api/invoices/upload", { method: "POST", body: form, signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.message || "Invoice upload failed.");
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  const invoice = body.data as InvoiceResult;
  const saved = await fetchAPI("/invoices/received", { method: "POST", body: JSON.stringify({ invoice, fileSize: file.size, mimeType: file.type }) });
  return saved.data;
}

export function importInvoiceLines(documentId: string, reportingPeriodId: string, rows: any[]) {
  return fetchAPI(`/invoices/${encodeURIComponent(documentId)}/import`, { method: "POST", body: JSON.stringify({ reportingPeriodId, rows, calculateOnSave: DEMO_MODE }) });
}
