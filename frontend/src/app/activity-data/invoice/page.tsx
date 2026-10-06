"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, FileText, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import PageShell from "@/components/dashboard/PageShell";
import { useReportingPeriodContext } from "@/context/ReportingPeriodContext";
import { fetchAPI, getDocumentById } from "@/lib/api";
import { importInvoiceLines, processInvoiceFile } from "@/lib/invoice-client";
import { backendCalculationMatches, finiteInvoiceNumber, INVOICE_CATEGORIES, INVOICE_MAX_BYTES, INVOICE_MAX_FILES, type InvoiceLine, type InvoiceResult } from "@/lib/invoice-contract";

type QueueFile = { id: string; file: File; status: "queued" | "processing" | "ready" | "failed"; document?: any; error?: string };
type ReviewLine = InvoiceLine & { selected: boolean; imported: boolean; quantityText: string; description: string; savedActivity?: any };
const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-slate-50 disabled:text-slate-500";
const button = "rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300";
const kg = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 6 });

export default function InvoiceUploadPage() {
  const { activePeriodId, activePeriod, isLocked, isPeriodReady } = useReportingPeriodContext();
  const [queue, setQueue] = useState<QueueFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<{ reachable: boolean; message: string } | null>(null);
  const [document, setDocument] = useState<any>(null);
  const [rows, setRows] = useState<ReviewLine[]>([]);
  const [activityDate, setActivityDate] = useState("");
  const [campuses, setCampuses] = useState<any[]>([]);
  const [campusId, setCampusId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const result: InvoiceResult | undefined = document?.invoiceResult;
  const buildings = campuses.find(c => c.id === campusId)?.buildings || [];
  const floors = buildings.find((b: any) => b.id === buildingId)?.floors || [];
  const selected = rows.filter(r => r.selected && !r.imported);
  const pending = queue.filter(q => ["queued", "failed"].includes(q.status));
  const canWrite = Boolean(isPeriodReady && activePeriodId && !isLocked);
  const locationReadOnly = saving || !canWrite || !rows.some(row => !row.imported);

  function openDocument(doc: any) {
    if (!doc?.invoiceResult) { setError("This older document has no ERP extraction. Upload its original file to process it with the invoice backend."); return; }
    const invoice: InvoiceResult = doc.invoiceResult;
    const firstSaved = doc.linkedActivities?.[0];
    setDocument(doc); setActivityDate(firstSaved?.activityDate?.slice(0, 10) || invoice.invoiceDate); setSavedIds([]); setError("");
    if (firstSaved) { setCampusId(firstSaved.campusId || ""); setBuildingId(firstSaved.buildingId || ""); setFloorId(firstSaved.floorId || ""); }
    setRows(invoice.items.map(line => {
      const imported = Boolean(doc.importedLines?.[line.id]);
      const savedActivity = doc.linkedActivities?.find((a: any) => a.invoiceLineId === line.id);
      return { ...line, imported, savedActivity, category: savedActivity?.category || line.category, scope: savedActivity?.scope || line.scope, unit: savedActivity?.unit || line.unit,
        selected: !imported && line.co2eKg != null && Number(line.quantity) > 0 && Boolean(line.unit), quantityText: String(savedActivity?.quantity ?? line.quantity), description: savedActivity?.description || [line.name, invoice.vendorName, invoice.invoiceNumber && `Invoice ${invoice.invoiceNumber}`].filter(Boolean).join(" · ") };
    }));
  }

  async function checkConnection() {
    try { const response = await fetch("/api/invoices/status", { cache: "no-store" }); setConnection(await response.json()); }
    catch { setConnection({ reachable: false, message: "Could not check the invoice backend. Start it and try again." }); }
  }

  useEffect(() => {
    let cancelled = false;
    checkConnection();
    fetchAPI("/onboarding/hierarchy").then(res => { if (!cancelled) setCampuses(res.data?.campuses || []); }).catch(err => { if (!cancelled) setError(err.message || "Could not load campuses."); });
    const documentId = new URL(window.location.href).searchParams.get("documentId");
    if (documentId) getDocumentById(documentId).then(res => { if (!cancelled) openDocument(res.data ?? res); }).catch(err => { if (!cancelled) setError(err.message || "Invoice was not found."); });
    return () => { cancelled = true; controllerRef.current?.abort(); };
  }, []);

  function addFiles(files: File[]) {
    if (busy) return;
    setError("");
    const next = [...queue]; const errors: string[] = [];
    for (const file of files) {
      if (next.some(q => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified)) continue;
      if (next.length >= INVOICE_MAX_FILES) { errors.push("A batch can contain up to 6 invoices. Clear this batch before adding more."); break; }
      if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) { errors.push(`${file.name}: choose PDF, PNG or JPEG.`); continue; }
      if (!file.size || file.size > INVOICE_MAX_BYTES) { errors.push(`${file.name}: choose a non-empty file no larger than 10 MB.`); continue; }
      next.push({ id: crypto.randomUUID(), file, status: "queued" });
    }
    setQueue(next); if (errors.length) setError(errors.join(" "));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function upload() {
    if (!canWrite || !pending.length || busy) return;
    setBusy(true); setError("");
    const controller = new AbortController(); controllerRef.current = controller;
    let first = true;
    for (const entry of pending) {
      if (controller.signal.aborted) break;
      setQueue(current => current.map(q => q.id === entry.id ? { ...q, status: "processing", error: "" } : q));
      try {
        const doc = await processInvoiceFile(entry.file, controller.signal);
        if (controller.signal.aborted) break;
        setQueue(current => current.map(q => q.id === entry.id ? { ...q, status: "ready", document: doc } : q));
        setConnection({ reachable: true, message: "Invoice backend is reachable." });
        if (first) { openDocument(doc); first = false; }
      } catch (err: any) {
        if (controller.signal.aborted) break;
        setQueue(current => current.map(q => q.id === entry.id ? { ...q, status: "failed", error: err.message || "Invoice processing failed." } : q));
      }
    }
    if (!controller.signal.aborted) setBusy(false);
  }

  function changeRow(id: string, patch: Partial<ReviewLine>) { setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row)); }
  function matches(row: ReviewLine) {
    const original = result?.items.find(line => line.id === row.id);
    const date = row.savedActivity?.activityDate || activityDate;
    return Boolean(original && backendCalculationMatches(original, { category: row.category, quantity: row.quantityText, unit: row.unit }) && (!result?.invoiceYear || Number(date.slice(0, 4)) === result.invoiceYear));
  }

  async function save() {
    if (!canWrite || !document || !activePeriodId || saving) return;
    if (!campusId) { setError("Select the campus for this invoice."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) { setError("Enter the invoice activity date before saving."); return; }
    if (!selected.length || selected.some(r => (finiteInvoiceNumber(r.quantityText) ?? 0) <= 0 || !r.unit.trim())) { setError("Every selected line needs a positive quantity and a unit."); return; }
    setSaving(true); setError("");
    try {
      const res = await importInvoiceLines(document.id, activePeriodId, selected.map(r => ({ lineId: r.id, category: r.category, scope: r.scope, quantity: finiteInvoiceNumber(r.quantityText), unit: r.unit, activityDate, description: r.description, campusId, buildingId: buildingId || undefined, floorId: floorId || undefined })));
      const doc = res.data.document; setDocument(doc); setSavedIds(res.data.activities.map((a: any) => a.id));
      setRows(current => current.map(r => doc.importedLines?.[r.id] ? { ...r, imported: true, selected: false, savedActivity: doc.linkedActivities?.find((a: any) => a.invoiceLineId === r.id) } : r));
      setQueue(current => current.map(q => q.document?.id === doc.id ? { ...q, document: doc } : q));
      const calculated = res.data.activities.filter((a: any) => a.status === "CALCULATED").length;
      toast.success(`${res.data.imported} invoice activities saved · ${calculated} calculated.`);
    } catch (err: any) { setError(err.message || "Could not save invoice activities."); }
    finally { setSaving(false); }
  }

  return (
    <PageShell title="Invoice Upload" subtitle="Extract invoice lines with the connected invoice backend">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
          <div><p className="font-semibold text-green-900">Connected invoice processing</p><p className="mt-1 text-sm text-green-800">Review extracted lines, then save them to update your dashboard with backend CO₂ results.</p><p className="mt-2 text-xs text-slate-600" role="status">{connection?.message || "Checking invoice backend…"}</p></div>
          <button onClick={checkConnection} className="rounded-lg border border-green-300 bg-white px-3 py-2 text-xs font-semibold text-green-800">Check connection</button>
        </div>
        {isLocked && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This reporting period is locked. Select an open period to upload or save invoices.</p>}
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><WarningCircle size={20} className="shrink-0" />{error}</p>}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Upload invoices</h1><p className="mt-1 text-sm text-slate-500">Up to 6 PDF, PNG or JPEG files per batch · 10 MB per file. Each file is processed separately.</p>
          <label onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }} className={`mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center ${dragging ? "border-green-500 bg-green-50" : "border-slate-200 bg-slate-50"}`}>
            <UploadSimple size={30} className="text-green-600" /><span className="font-semibold text-slate-800">Choose invoices or drop them here</span><span className="text-xs text-slate-500">Original files are sent to your invoice backend for extraction.</span>
            <input ref={fileRef} type="file" aria-label="Invoice files" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" multiple disabled={busy || !canWrite} onChange={e => addFiles(Array.from(e.target.files || []))} />
          </label>
          {!!queue.length && <ul className="mt-4 space-y-2">{queue.map(q => <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"><div className="flex min-w-0 items-start gap-2"><FileText size={22} className="shrink-0 text-slate-500" /><div className="min-w-0"><p className="break-all text-sm font-medium text-slate-800">{q.file.name}</p><p className={`text-xs ${q.status === "failed" ? "text-red-600" : "text-slate-500"}`}>{q.status === "ready" ? `${q.document.invoiceResult.items.length} lines extracted` : q.status === "processing" ? "Extracting invoice…" : q.status === "failed" ? q.error : `${(q.file.size / 1024).toFixed(0)} KB · Ready to upload`}</p></div></div><div className="flex items-center gap-3">{q.status === "ready" && <button disabled={busy || saving} onClick={() => openDocument(q.document)} className="text-sm font-semibold text-green-700" aria-label={`Review ${q.file.name}`}>Review lines</button>}{!busy && q.status !== "ready" && <button aria-label={`Remove ${q.file.name}`} onClick={() => setQueue(current => current.filter(f => f.id !== q.id))} className="text-slate-400 hover:text-red-600"><X size={18} /></button>}</div></li>)}</ul>}
          <div className="mt-4 flex flex-wrap items-center gap-4"><button className={button} disabled={busy || !pending.length || !canWrite} onClick={upload}>{busy ? "Processing batch…" : "Upload & Extract"}</button><button disabled={busy || saving || !queue.length} onClick={() => { setQueue([]); setDocument(null); setRows([]); setSavedIds([]); setError(""); }} className="text-sm text-slate-500 disabled:opacity-40">Clear batch</button><Link href="/documents" className="text-sm font-medium text-green-700">Open Document Hub →</Link></div>
        </section>

        {result && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="break-all text-lg font-bold text-slate-900">Review: {result.fileName}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-4">{[["Extraction", result.provider], ["Country", result.country || result.region || "Not provided"], ["Vendor", result.vendorName || "Not provided"], ["Invoice", result.invoiceNumber || "Not provided"]].map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-medium text-slate-800">{value}</p></div>)}</div>
          {result.totalKg != null && <p className="mt-3 text-sm font-semibold text-green-800">Backend invoice total: {kg(result.totalKg)} kgCO₂e <span className="font-normal text-slate-500">· added to this workspace only after review and calculation</span></p>}
          <p className="mt-3 text-xs leading-5 text-slate-600">Confirm category, scope, consumption quantity, date and location against the invoice. Scope is a suggestion; assign it to your reporting boundary. Changing quantity, unit, category or invoice year requires a new backend calculation. Such rows can be submitted for review, but cannot use a demo factor.</p>
          {result.warnings.map((warning, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{warning}</p>)}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">Invoice activity date<input aria-label="Invoice activity date" className={`${field} mt-1`} type="date" value={activityDate} onChange={e => setActivityDate(e.target.value)} disabled={locationReadOnly} /></label>
            <label className="text-xs font-medium text-slate-600">Campus · required<select aria-label="Invoice campus" className={`${field} mt-1`} value={campusId} disabled={locationReadOnly} onChange={e => { setCampusId(e.target.value); setBuildingId(""); setFloorId(""); }}><option value="">Select campus</option>{campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Building · optional<select aria-label="Invoice building" className={`${field} mt-1`} value={buildingId} disabled={locationReadOnly || !campusId} onChange={e => { setBuildingId(e.target.value); setFloorId(""); }}><option value="">Whole campus</option>{buildings.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Floor · optional<select aria-label="Invoice floor" className={`${field} mt-1`} value={floorId} disabled={locationReadOnly || !buildingId} onChange={e => setFloorId(e.target.value)}><option value="">Whole building</option>{floors.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Selected period: {activePeriod?.name || "Resolving…"}. The activity date must fall within this period. <Link href="/reporting-periods" className="text-green-700 underline">Manage periods</Link></p>
          <p className="mt-1 text-xs text-slate-500">Date and location apply to selected unsaved lines. Saved rows keep their own reviewed values and locations below.</p>
          <div className="mt-5 space-y-4">{rows.map((row, i) => {
            const original = result.items.find(line => line.id === row.id)!;
            const hasCalculation = matches(row);
            return <article key={row.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><label className="flex items-start gap-3"><input aria-label={`Include line ${i + 1}`} type="checkbox" className="mt-1 h-4 w-4 accent-green-600" checked={row.selected} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { selected: e.target.checked })} /><span><span className="text-sm font-semibold text-slate-900">{i + 1}. {row.name}</span><span className="mt-1 block text-xs text-slate-500">Backend category: {original.sourceCategory || "unclassified"}</span></span></label><p className={`text-xs font-semibold ${hasCalculation ? "text-green-700" : "text-amber-700"}`}>{row.imported ? hasCalculation ? `Saved · ${row.savedActivity?.status?.replaceAll("_", " ") || "Submitted"}` : "Saved · Needs backend calculation" : hasCalculation ? `${kg(original.co2eKg!)} kgCO₂e · Backend result` : "Needs backend calculation"}</p></div>
              {row.savedActivity && <p className="mt-2 text-xs text-slate-500">Saved: {row.savedActivity.activityDate.slice(0, 10)} · {[row.savedActivity.campus?.name, row.savedActivity.building?.name, row.savedActivity.floor?.name].filter(Boolean).join(" / ")}</p>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-slate-500">Category<select aria-label={`Category line ${i + 1}`} className={`${field} mt-1`} value={row.category} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { category: e.target.value, scope: INVOICE_CATEGORIES.find(c => c[0] === e.target.value)?.[2] || "SCOPE_3" })}>{INVOICE_CATEGORIES.map(c => <option key={c[0]} value={c[0]}>{c[1]}</option>)}</select></label>
                <label className="text-xs text-slate-500">Scope<select aria-label={`Scope line ${i + 1}`} className={`${field} mt-1`} value={row.scope} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { scope: e.target.value })}>{[1, 2, 3].map(n => <option key={n} value={`SCOPE_${n}`}>Scope {n}</option>)}</select></label>
                <label className="text-xs text-slate-500">Consumption quantity<input aria-label={`Quantity line ${i + 1}`} className={`${field} mt-1`} type="number" step="any" min="0" value={row.quantityText} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { quantityText: e.target.value })} /></label>
                <label className="text-xs text-slate-500">Unit<input aria-label={`Unit line ${i + 1}`} className={`${field} mt-1`} value={row.unit} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { unit: e.target.value })} /></label>
              </div>
              <label className="mt-3 block text-xs text-slate-500">Description<input aria-label={`Description line ${i + 1}`} className={`${field} mt-1`} value={row.description} disabled={row.imported || saving || !canWrite} onChange={e => changeRow(row.id, { description: e.target.value })} /></label>
              <p className="mt-2 text-xs text-slate-500">{original.factorSource}{original.factorDataset && ` · ${original.factorDataset}`}{original.factorVersion && ` · ${original.factorVersion}`}{original.factorValue != null && ` · Factor: ${original.factorValue} ${original.factorUnit}`}{original.converted && ` · Backend converted quantity: ${original.converted.value} ${original.converted.unit}`}</p>
              {original.issue && <p className="mt-2 text-xs text-amber-700">{original.issue}</p>}
            </article>;
          })}</div>
          {!rows.length ? <p className="mt-4 text-sm text-amber-800">No invoice lines were returned. Try a clearer file or <Link className="underline" href="/activity-data/add">add activity manually</Link>.</p> : <><p className="mt-4 text-xs text-slate-600">Saving confirms the selected values. Matching backend results appear in dashboard totals immediately; changed or unmatched lines stay pending.</p><button className={`${button} mt-3`} disabled={!selected.length || saving || busy || !canWrite} onClick={save}>{saving ? "Saving…" : `Save & calculate selected (${selected.length})`}</button></>}
          {!!savedIds.length && <div role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900"><p className="flex items-center gap-2 font-semibold"><CheckCircle size={20} />{savedIds.length} invoice activities saved.</p><p className="mt-2">Valid backend results are included in dashboard totals. Lines needing a new backend calculation remain pending and are excluded from emissions.</p><div className="mt-3 flex gap-4 font-semibold"><Link href="/dashboard">View updated dashboard →</Link><Link href="/review">Review pending lines →</Link><Link href="/activity-data">View activities →</Link></div></div>}
        </section>}
      </div>
    </PageShell>
  );
}
