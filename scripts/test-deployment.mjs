// Production startup/proxy smoke test. Uses local fixtures only: no live DB or OCR API.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
let checks = 0;
let forwarded = 0;
const serverToken = "local-deployment-test-token";
const demoToken = "carbonsynq-demo-session";
const mock = createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ success: true }));
  }
  try {
    assert.equal(req.url, "/api/erp/upload");
    assert.equal(req.headers.authorization, `Bearer ${serverToken}`);
    assert.match(req.headers["content-type"], /^multipart\/form-data; boundary=/);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString();
    assert.ok(bytes.includes('name="file"; filename="IN_invoice.pdf"'));
    assert.ok(bytes.includes("%PDF-1.7\noriginal invoice fixture"));
    forwarded++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: true, country: { region: "IN" }, extraction: { provider: "gemini", invoice_date: "2026-10-04" }, emission: { results: [{ item_name: "Electricity", category: "electricity", value: 10, unit: "kWh", status: "calculated", co2e: 7.117, co2e_unit: "kg", factor_value: 0.7117 }] } }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, message: error.message }));
  }
});

async function port() {
  const temporary = createServer();
  await new Promise(resolve => temporary.listen(0, "127.0.0.1", resolve));
  const value = temporary.address().port;
  await new Promise(resolve => temporary.close(resolve));
  return value;
}
function start(args, project, env) {
  const child = spawn(process.execPath, args, { cwd: join(root, project), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { child.output = (child.output + chunk).slice(-8000); });
  return child;
}
async function ready(url, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${child.output}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Startup timed out: ${child.output}`);
}
async function check(name, task) {
  await task();
  checks++;
  console.log(`PASS ${name}`);
}
function upload(base, origin, token = demoToken) {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.7\noriginal invoice fixture\n%%EOF"], "IN_invoice.pdf", { type: "application/pdf" }));
  return fetch(`${base}/api/invoices/upload`, { method: "POST", body: form, headers: { origin, authorization: `Bearer ${token}` } });
}

try {
  await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const backendPort = await port();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const fakeEnv = { NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "test-only-not-a-credential", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test", DB_HOST: "127.0.0.1", DB_USER: "test", DB_NAME: "test", GEMINI_API_KEY: "", AFFINDA_API_KEY: "", MISTRAL_API_KEY: "", CLIMATIQ_API_KEY: "" };
  const backend = start(["dist/app.js"], "backend", { ...fakeEnv, PORT: String(backendPort), INVOICE_BACKEND_AUTH_TOKEN: serverToken });
  await ready(backendUrl, backend);
  await check("Backend binds its numeric PORT and serves a public health check", async () => {
    assert.equal((await (await fetch(backendUrl)).json()).success, true);
  });
  await check("Backend API rejects absent/wrong tokens and accepts the matching server token", async () => {
    for (const authorization of ["", "Bearer wrong", `Bearer ${serverToken}extra`]) {
      assert.equal((await fetch(`${backendUrl}/api/erp/upload`, { method: "POST", headers: { authorization } })).status, 401);
    }
    const response = await fetch(`${backendUrl}/api/erp/upload`, { method: "POST", headers: { authorization: `Bearer ${serverToken}` } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /No file uploaded/);
  });
  const legacyPort = await port();
  const legacy = start(["dist/app.js"], "backend", { ...fakeEnv, PORT: String(legacyPort), INVOICE_BACKEND_AUTH_TOKEN: "" });
  await ready(`http://127.0.0.1:${legacyPort}`, legacy);
  await check("An unset backend token preserves existing local startup/upload behavior", async () => {
    assert.equal((await fetch(`http://127.0.0.1:${legacyPort}/api/erp/upload`, { method: "POST" })).status, 400);
  });
  const frontendPort = await port();
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const publicOrigin = "https://deployment-smoke.onrender.com";
  const frontend = start(["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"], "frontend", { NODE_ENV: "production", PORT: String(frontendPort), NEXT_PUBLIC_DEMO_MODE: "true", INVOICE_BACKEND_URL: mockUrl, INVOICE_BACKEND_AUTH_TOKEN: serverToken, RENDER_EXTERNAL_URL: publicOrigin, WORKSPACE_PUBLIC_URL: "" });
  await ready(`${frontendUrl}/api/health`, frontend);
  await check("Frontend production health and login routes respond", async () => {
    assert.equal((await (await fetch(`${frontendUrl}/api/health`)).json()).success, true);
    assert.equal((await fetch(`${frontendUrl}/auth/signin`)).status, 200);
  });
  await check("Frontend status reaches the configured invoice backend", async () => {
    assert.equal((await (await fetch(`${frontendUrl}/api/invoices/status`)).json()).reachable, true);
  });
  await check("Render HTTPS upload forwards original bytes and server-only auth through production Next.js", async () => {
    const response = await upload(frontendUrl, publicOrigin);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items[0].co2eKg, 7.117);
    assert.ok(!JSON.stringify(body).includes(serverToken));
    assert.equal(forwarded, 1);
  });
  await check("Foreign origins are rejected before contacting the invoice backend", async () => {
    assert.equal((await upload(frontendUrl, "https://foreign.example.com")).status, 403);
    assert.equal(forwarded, 1);
  });
  await check("Unauthorized uploads are rejected before contacting the invoice backend", async () => {
    assert.equal((await upload(frontendUrl, publicOrigin, "invalid")).status, 401);
    assert.equal(forwarded, 1);
  });
  console.log(`${checks} deployment smoke groups passed. No live provider/database was contacted.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    if (child.exitCode === null) await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await new Promise(resolve => mock.close(resolve));
}
