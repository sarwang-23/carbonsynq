# University onboarding and connected invoice demo

## Sabse jaldi setup

Tumhara invoice backend already sahi chal raha hai to use **port 5000** par running rakho. ZIP extract karke Windows mein `START_DEMO_WINDOWS.bat`, ya macOS/Linux mein `bash start-demo.sh` chalao. Frontend http://localhost:3000/auth/signin par milega. **Open university demo** click karo.

Agar isi ZIP ka backend chalana hai, apni **working backend `.env`** ko `backend/.env` mein copy karo. Windows par `START_FULL_DEMO_WINDOWS.bat` dono terminals kholega. Mac/Linux mein `bash start-invoice-backend.sh` aur `bash start-demo.sh` alag terminals mein chalao. Node.js 24 aur pehli dependency installation ke liye internet chahiye. Backend ki original source files preserve hain. Database backup restore ya migration mat chalao; adapter ko unki zarurat nahi.

Different port/host ho to `frontend/.env.example` ki copy `.env.local` banao, `INVOICE_BACKEND_URL` mein backend ka root URL do (e.g. `http://127.0.0.1:5000`, **without `/api`**), aur frontend restart karo. `NEXT_PUBLIC_DEMO_MODE=true` rakho. Gemini/Affinda/Mistral/Climatiq, Supabase aur database configuration backend ke `.env` mein hi rahegi.

## 8–10 minute presentation

1. **Login → onboarding (2 min):** Open university demo click karte hi onboarding khulega. Legal/display name, university details, campus/building/floor hierarchy aur Scope 1/2 setup review/edit karein. **Create Workspace** se profile save hoga aur **Activity Data** khulega. Defaults mein 2 campuses, 4 buildings aur 12 floors hain; save ke baad duplicate structures/reporting periods nahi bante. Draft edits refresh par bhi rehte hain.
2. **Demo preview (1 min):** pehli activity save/import hone tak dashboard par sample charts chalte hain. Initial FY 2026–27 footprint 692.237 tCO2e hai: Scope 1 86.572, Scope 2 605.665. Profile save, Excel preview aur invoice extraction se abhi sample ledger nahi hatta.
3. **Real invoice upload (3 min):** Activity Data → Upload Invoice. Backend status reachable hona chahiye. 1–6 invoices select karke **Upload & Extract** click karein. PDF, PNG, JPEG accepted; per file max 10 MB. Backend extraction provider, country, vendor, invoice number, line quantities, factor source aur actual CO2 result dikhata hai. Har successful file ke **Review lines** se uski extraction khol sakte hain. Ek file fail ho to uska error dikhata hai; baaki files ki extraction safe rehti hai.
4. **Review and save (1 min):** consumption quantity, unit, category/scope, date aur campus confirm karein. **Save & calculate selected** aapki reviewed values save karta hai; valid original backend CO2 results turant totals mein aate hain. Changed/unmatched rows SUBMITTED/pending rehti hain. Same extraction line dobara save nahi hoti.
5. **Your data (1 min):** pehle saved activity/import par sample activities, sample baseline/targets aur sample recommendations active workspace se hat jaate hain. Subsequent saves aapke existing records mein judte hain. LPG litres aur Malaysia converted-unit CO2 preserve hote hain. Invoice results par demo factor substitute nahi hota. **View updated dashboard** se sirf apna inventory dekhein.
6. **Report (1 min):** Reports → Generate report → Download se PDF milta hai. Backend vs illustrative-factor record counts separate hain. User-data report mein sample ledger excluded hai. Existing report snapshot fixed rehta hai; latest totals ke liye naya report generate karein.

## Invoice rules

- Backend ka total extraction summary hai. Workspace mein sirf saved, reviewed aur CALCULATED rows total mein add hoti hain.
- Scope/category suggestions reporting boundary ke against confirm karein. Travel/material lines Scope 3 suggest hoti hain; all lines ko electricity nahi banaya jata.
- Quantity/unit/category/invoice year change ho to cached backend result invalid ho jata hai. Aisi row submit kar sakte hain, lekin calculation par clear error aayega. Clearer/corrected invoice re-upload karke backend se new result lein. Demo factor automatically substitute nahi hota.
- Backend review/failed lines automatically select nahi hoti; missing CO2 ko zero nahi maana jata. Valid backend zero emissions preserve hoti hain.
- Invoice date selected reporting period ke andar honi chahiye. Older invoice ke liye Reporting Periods se matching open period select/create karein. Locked periods save/calculate block karti hain.
- Files sequentially process hoti hain; extraction time provider/network par depend karega. Default timeout per file 180 seconds hai. `INVOICE_BACKEND_TIMEOUT_MS` se change karke frontend restart kar sakte hain. Processing ke dauran tab open rakhein.
- Saved invoice dobara kholne par reviewed values, current status aur selected location retain hoti hain; original backend extraction alag preserve rehti hai.
- Document Hub normalized results aur source metadata browser mein rakhta hai; uploaded file bytes retain nahi karta. Original invoices apne paas rakhein.
- Returning login Activity Data par resume karta hai. Refresh/restart se onboarding aur saved activities isi browser mein rehti hain. Last draft delete karne par user dashboard empty rahega; sample data automatically wapas nahi aata.
- Reset demo confirmation ke baad local university setup/invoice/activity/report data clear karta hai aur onboarding par sample workspace restore karta hai; backend records delete nahi karta.

## Backup demo flows

Manual entry: Main Campus → Academic Block → Ground Floor; Diesel, `100 L`, activity date `2026-10-04`. **Save & calculate** click karein; dashboard `268 kgCO2e` illustrative estimate dikhayega. **Save Draft** bhi available hai; draft emissions totals mein nahi aata. Draft ko Review workflow se submit/verify/calculate kar sakte hain.

Excel import: `/demo/unstructured-activity-sample.xlsx` upload karein. Preview mein 3 valid aur 1 invalid row milegi. **Import & calculate (3)** se valid rows ke illustrative estimates dashboard mein aayenge. Invalid row import nahi hoti. Other files: `/demo/activity-sample.csv` aur `/demo/sample-electricity-invoice.pdf`.

Bundled sample PDF bhi **real backend** ko bheja jata hai; ab preset OCR fields use nahi hote. Country detection ke liye clear invoice text/currency use karein. Supplied backend supports filename region hints such as `IN_`, `MY_`, `DE_`, `FR_`, `US_`, `GB_`/`UK_`, `AU_`; correct region prefix use kar sakte hain if needed.

## Agar upload nahi ho raha

| Message | Action |
| --- | --- |
| Backend not reachable | Backend terminal/startup error check karein; port/URL sahi karein; Check connection click karein. |
| SUPABASE_URL / service key missing | Working backend `.env` reuse karein. Blank example file alone enough nahi hai. |
| Country could not be detected | Invoice region/currency clear karein; correct filename region hint use karein. |
| No invoice lines | Clearer PDF/image upload karein; provider configuration/logs check karein. Blank extraction par fake fields nahi aate. |
| No backend calculation / edited values | Corrected invoice re-upload karein; Review status/error inspect karein. |
| Date outside period | Invoice date ke corresponding open reporting period select karein. |
| Timed out | Backend/provider status check karein, then retry the failed file. Previous backend write may already have occurred. |

Local regression/browser tests mock the ERP response because no working provider credentials were supplied here. Actual provider extraction must be checked with your existing `.env` and a reference invoice before presenting.
