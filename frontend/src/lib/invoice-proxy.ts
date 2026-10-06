import { INVOICE_MAX_BYTES, normalizeInvoiceResponse } from "./invoice-contract";
import { DEMO_MODE, DEMO_TOKEN } from "./demo-store";

function backendUrl(): URL {
  const base = new URL(process.env.INVOICE_BACKEND_URL || "http://127.0.0.1:5000");
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Set INVOICE_BACKEND_URL to an HTTP(S) backend URL.");
  return base;
}
function timeoutMs() {
  const value = Number(process.env.INVOICE_BACKEND_TIMEOUT_MS || 180000);
  return Number.isFinite(value) ? Math.max(1000, Math.min(value, 600000)) : 180000;
}
const failure = (message: string, status: number) => Response.json({ success: false, message }, { status });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const looksLikeHtml = (raw: string) => /^\s*<(!doctype|html|head|body|\?xml)/i.test(raw);

/** Cold-start gateway failures are retried once before reporting them. */
const isTransientGatewayFailure = (status: number, payload: any) => [502, 503, 504].includes(status) && payload === null;

function retryDelayMs() {
  const value = Number(process.env.INVOICE_BACKEND_RETRY_DELAY_MS);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 30000)) : 10000;
}

/** Human-readable reason for a rejected upload; never leaks HTML or CSS from an intermediary. */
function rejectionDetail(status: number, raw: string, payload: any): string {
  const backendMessage = typeof payload?.message === "string" && payload.message.trim() ? payload.message : undefined;
  if (backendMessage) return backendMessage;
  const body = raw.trim();
  if (!body) return `Backend returned HTTP ${status} with an empty response body. Confirm INVOICE_BACKEND_URL points to the running ERP backend.`;
  if (looksLikeHtml(body)) return `The invoice service answered HTTP ${status} with an HTML error page instead of JSON, which means it is asleep, restarting or not the invoice backend. Wait about 30 seconds and upload again; if it keeps failing, check that the backend service is running and that INVOICE_BACKEND_URL is its root URL without an /api suffix.`;
  if (payload) return `Backend returned HTTP ${status} with an unexpected payload: ${JSON.stringify(payload).slice(0, 300)}`;
  return `Backend returned HTTP ${status} with a non-JSON response: ${body.slice(0, 300)}`;
}

function workspaceOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const urls = [request.url, process.env.WORKSPACE_PUBLIC_URL, process.env.RENDER_EXTERNAL_URL];
  return urls.some(value => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === origin;
    } catch { return false; }
  });
}

export async function invoiceStatus(): Promise<Response> {
  try {
    const response = await fetch(new URL("/", backendUrl()), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const result = await response.json().catch(() => null);
    const reachable = response.ok && result?.success === true;
    return Response.json({ reachable, message: reachable ? "Invoice backend is reachable." : "Invoice backend health check failed. Check the configured backend URL." });
  } catch {
    return Response.json({ reachable: false, message: "Start the invoice backend on port 5000, or set INVOICE_BACKEND_URL in frontend/.env.local and restart the frontend." });
  }
}

export async function proxyInvoiceUpload(request: Request): Promise<Response> {
  if (DEMO_MODE && request.headers.get("authorization") !== `Bearer ${DEMO_TOKEN}`) return failure("Sign in to the university demo before uploading an invoice.", 401);
  if (!workspaceOriginAllowed(request)) return failure("Upload invoices from this university workspace.", 403);
  if (Number(request.headers.get("content-length") || 0) > INVOICE_MAX_BYTES + 1024 * 1024) return failure("Maximum invoice size is 10 MB.", 413);
  let file: File;
  try {
    const form = await request.formData();
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) return failure("Choose one invoice per request using the file field.", 400);
    file = files[0];
    if (!file.size || file.size > INVOICE_MAX_BYTES) return failure("Choose a non-empty invoice no larger than 10 MB.", 413);
  } catch { return failure("The invoice upload must use multipart form data.", 400); }
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();
  let mime = "";
  if (ext === "pdf" && new TextDecoder().decode(head).startsWith("%PDF-")) mime = "application/pdf";
  if (ext === "png" && head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71) mime = "image/png";
  if (["jpg", "jpeg"].includes(ext || "") && head[0] === 255 && head[1] === 216) mime = "image/jpeg";
  if (!mime) return failure("Choose a valid PDF, PNG or JPEG invoice. WebP is not supported by this backend.", 415);
  try {
    const send = async () => {
      const form = new FormData();
      form.append("file", new Blob([await file.arrayBuffer()], { type: mime }), file.name);
      const headers = new Headers();
      if (process.env.INVOICE_BACKEND_AUTH_TOKEN) headers.set("Authorization", `Bearer ${process.env.INVOICE_BACKEND_AUTH_TOKEN}`);
      const response = await fetch(new URL("/api/erp/upload", backendUrl()), { method: "POST", body: form, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs()) });
      const raw = await response.text().catch(() => "");
      let payload: any = null;
      try { payload = JSON.parse(raw); } catch { /* Non-JSON body from the backend or an intermediary. */ }
      return { response, raw, payload };
    };
    let attempt = 0;
    for (;;) {
      const { response, raw, payload } = await send();
      if (response.ok && payload && payload.success !== false) {
        if ((typeof payload.extraction !== "object" && !payload.extraction_provider) || (typeof payload.emission !== "object" && payload.status !== "extraction_empty")) return failure("The backend returned an unexpected invoice response. Confirm INVOICE_BACKEND_URL points to the supplied ERP backend.", 502);
        return Response.json({ success: true, data: normalizeInvoiceResponse(payload, file.name) });
      }
      console.error(`[invoice-proxy] backend rejected upload (HTTP ${response.status}):`, raw.slice(0, 800));
      // A proxy 502 with an HTML body is usually a backend still waking up or
      // restarting; one retry turns that cold start into a successful upload.
      if (isTransientGatewayFailure(response.status, payload) && attempt === 0) {
        attempt++;
        await sleep(retryDelayMs());
        continue;
      }
      // An HTML or empty body is never a usable invoice answer: report it as a
      // gateway failure with an actionable message instead of leaking markup.
      const status = response.ok ? (payload?.success === false ? 422 : 502) : response.status;
      return failure(`Invoice backend rejected the upload (HTTP ${status}). ${rejectionDetail(status, raw, payload)}`, status);
    }
  } catch (error: any) {
    if (["TimeoutError", "AbortError"].includes(error?.name)) return failure("Invoice processing timed out. Check the backend/provider status before retrying this file.", 504);
    return failure("Invoice processing could not complete. Start the backend on port 5000 or check INVOICE_BACKEND_URL, its logs and provider credentials.", 502);
  }
}
