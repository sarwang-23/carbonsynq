# CarbonSynq University Demo — Onboarding and Connected Invoices

This bundle opens university onboarding after fresh login, then Activity Data. Until the first saved activity/import, the dashboard previews the sample ledger. The first successful save removes sample activities and sample baselines/targets from active totals. Later entries accumulate as your inventory. Authentication, onboarding, reporting periods and aggregation remain local to the browser. Invoice extraction and emission results come from your working backend; manual/Excel estimates use illustrative factors.

## Run

Use Node.js 24. If your working backend already runs on port 5000, keep it running and start only this frontend:

```bash
npm ci
npm run dev
```

Open http://localhost:3000/auth/signin and click **Open university demo**. Credentials: `demo@carbonsynq.test` / `Demo@2026`.

Review/edit the onboarding form, then **Create Workspace** to open Activity Data. Manual **Save & calculate** and Excel **Import & calculate** open the updated dashboard. **Save Draft** keeps emissions pending until review/calculation. Returning sign-in resumes Activity Data; profile, draft form and saved activities survive refresh in the same browser.

To run the bundled backend, reuse your working backend `.env` in the ZIP's `backend` folder, then run `npm ci` and `npm run dev` there. The original backend needs its configured Supabase, factor database and extraction-provider credentials. Do not restore a database backup or run migrations just to use this integration.

The frontend defaults to `http://127.0.0.1:5000`. For another backend URL, copy `.env.example` to `.env.local`, set server-only `INVOICE_BACKEND_URL` to the backend root URL without `/api`, and restart Next.js. Keep `NEXT_PUBLIC_DEMO_MODE=true`; this invoice backend does not supply the university V2 API.

## Invoice flow

1. Open **Activity Data → Upload Invoice** or **Document Hub → Upload Invoices**.
2. Select up to 6 PDF/PNG/JPEG files, each at most 10 MB. Click **Upload & Extract**. Files are processed sequentially; an error on one file does not discard successful extractions.
3. Review every invoice's line items. Confirm consumption quantities, original units, category/scope, billing date and campus. Building and floor are optional. Missing dates must be entered explicitly.
4. **Save & calculate selected** confirms reviewed values and immediately includes matching original backend results in inventory. Edited/unmatched lines remain **SUBMITTED**, with no fabricated emissions. The same extracted line cannot be saved twice.
5. **View updated dashboard** shows only your saved, calculated activities. Document Hub reopens cached results, reviewed values and locations after reload.
6. Draft and pending rows can use the existing **Review → Audit Record → Verify & Calculate** workflow. Invoice calculations preserve the original backend result and reject mismatched quantities/units/category/year.

India and Malaysia response formats, multi-line invoices, factor provenance, converted units and zero emissions are supported. Unknown materials are suggested as Other purchased goods/services (Scope 3); users must confirm their reporting boundary. Backend-review/failed rows remain uncalculated. Editing quantity, unit, category or invoice year invalidates the stored result. Re-upload a clearer/corrected invoice for a new backend calculation.

## Workspace features and boundaries

Demo sign-in, hierarchy, period locks, manual review/calculation, actual CSV/XLSX parsing, targets, charts, audit events and downloadable snapshot PDFs remain available. Preview/extraction/failed validation does not switch data modes. After the first save, samples stay excluded even when a period has no entries or the last draft is deleted. Only explicit **Reset demo** restores the samples and reopens onboarding. Version-1 stored workspaces migrate without losing existing user activities. Only calculated rows contribute to emission totals; small values and single-month charts remain visible. Reports snapshot the data mode and distinguish backend results from illustrative-factor rows.

Local workspace records and normalized invoice results persist in this browser. Original document binaries are not retained by this frontend; keep your files. **Reset demo** clears locally imported invoice records as well as other changes. It does not remove records written by the invoice backend to its configured services.

Uploading invoices makes real requests to the backend and its configured extraction/emission providers, including the backend's existing database writes. Keys stay in the backend environment. This demo account and browser storage are intended for a local presentation, not production authentication or multi-user storage.

## Checks

```bash
npm run lint
npm run typecheck
npm run test:demo
npm run test:invoices
npm run test:onboarding
npm run build
npm start
```

The invoice regression tests use representative ERP responses and do not contact providers. Full setup, architecture and validation details are in the ZIP root guides. A complete live university deployment still requires the missing V2 service; switching demo mode off does not turn the supplied invoice service into that API.
