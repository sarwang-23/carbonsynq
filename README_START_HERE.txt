RENDER DEPLOYMENT

Frontend aur invoice backend dono included hain. Cloud deployment ke liye DEPLOY_RENDER.md kholein. Repository root par render.yaml, frontend/ aur backend/ upload karein, phir Render -> New -> Blueprint. Working backend ki Supabase, database aur Gemini values Environment mein set karein.

Local demo ke purane steps bhi neeche available hain.

CARBONSYNQ UNIVERSITY DEMO — ONBOARDING AND YOUR ACTIVITY DATA

QUICKEST WAY (your invoice backend already works):
1. Extract this ZIP.
2. Keep your working invoice backend running on port 5000.
3. Windows: double-click START_DEMO_WINDOWS.bat.
   macOS/Linux: run bash start-demo.sh
4. Open http://localhost:3000/auth/signin
5. Click Open university demo.
6. Complete the university onboarding form -> Create Workspace.
7. Activity Data opens. Choose Manual Entry, Excel / CSV or Upload Invoice.
8. Until your first valid saved entry/import, the dashboard shows sample data.
9. Save & calculate / Import & calculate updates the dashboard with your data.
   The sample activity ledger and sample baseline are excluded at the first save.

TO RUN BOTH PROJECTS FROM THIS ZIP:
1. Copy your WORKING backend .env into the backend folder.
   Use your existing configured database and provider keys.
2. Windows: START_FULL_DEMO_WINDOWS.bat opens two terminals.
   Or start START_INVOICE_BACKEND_WINDOWS.bat, then START_DEMO_WINDOWS.bat.
   macOS/Linux: bash start-invoice-backend.sh in one terminal;
   bash start-demo.sh in another.
3. Keep both terminals open. Backend: port 5000; frontend: port 3000.

Requires Node.js 24. First installation needs internet access.
For a hosted/different backend, copy frontend/.env.example to .env.local,
set INVOICE_BACKEND_URL to its ROOT URL (no /api suffix), and restart frontend.
Keep NEXT_PUBLIC_DEMO_MODE=true.

Login: demo@carbonsynq.test / Demo@2026

Invoices: REAL backend extraction/emissions, up to 6 files per batch,
PDF/PNG/JPEG, 10 MB each. Review extracted lines, choose date/campus,
Save & calculate selected to update totals using valid original backend results.
Edited/unmatched invoice lines remain pending; no demo invoice result is invented.
Manual/Excel estimates use illustrative factors. Save Draft records are excluded
from emission totals until submitted, verified and calculated in Review.
Returning login opens Activity Data; university setup and data survive refresh.
Workspace storage is local to this browser. Original backend source is included.

No secrets are included. Reuse your working backend configuration.
No database restore, migration or schema change is needed for this adapter.

DEMO_GUIDE.md: Hindi/English walkthrough and invoice troubleshooting.
ARCHITECTURE_AND_API_AUDIT.md: what is real and what stays in demo mode.
TEST_RESULTS.md: checks run and live-provider verification limits.
