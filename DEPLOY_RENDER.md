# CarbonSynq ko Render par deploy karein

Is folder mein frontend aur invoice backend dono hain. `render.yaml` dono services ko ek saath configure karta hai. Frontend Node web service hai, kyunki invoice upload ke liye Next.js server API chahiye. Backend Docker service hai, jisme Node 24, Chromium aur LibreOffice ki settings hain.

## 1. GitHub par code upload karein

1. ZIP extract karein aur `CarbonSynq-Onboarding-Demo` folder kholein.
2. Apne GitHub account mein ek repository banayein (private bhi chalti hai).
3. **Folder ke andar ki files** upload karein. ZIP file ko code ki jagah upload na karein.
4. Repository root par `render.yaml`, `frontend/` aur `backend/` dikhne chahiye. Inhe ek aur outer folder ke andar na rakhein.

Repository layout:

```text
render.yaml
frontend/package.json
backend/package.json
backend/Dockerfile
DEPLOY_RENDER.md
```

Apni actual `.env` file upload na karein. Isi archive mein original database backup bhi preserved hai. Deployment existing working database se connect karta hai; backup restore automatic nahi hota. Docker build backup aur generated report folders ko exclude karta hai.

## 2. Render par Blueprint create karein

1. [Render Dashboard](https://dashboard.render.com/) kholein.
2. **New → Blueprint** select karein.
3. GitHub account connect karke upar wala repository select karein. Private repository ho to Render ko us repository ka access dein.
4. Branch select karein. Blueprint path `render.yaml` rakhein.
5. Neeche ke four values apne **working backend ki `.env`** se fill karein:

| Backend variable | Kya fill karna hai |
| --- | --- |
| `SUPABASE_URL` | Wahi Supabase project URL jo working backend use karta hai |
| `SUPABASE_SERVICE_ROLE_KEY` | Wahi server service-role key; frontend par nahi |
| `DATABASE_URL` | Wahi PostgreSQL/Neon connection string jisme emission-factor tables hain |
| `GEMINI_API_KEY` | Working invoice extractor ki Gemini API key |

`DATABASE_URL` ka password URL-encoded hona chahiye. Agar working backend `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` use karta hai, manual setup neeche use karein aur wahi variables copy karein.

6. Configuration review karke **Deploy Blueprint** karein.
7. Dono services ke **Live** hone ka wait karein. First backend Docker build ko dependencies install karni hain.

Blueprint default mein **Free** compute use karta hai aur naya database create nahi karta. Existing Supabase tables aur emission-factor database pehle se working hone chahiye. Koi migration, restore ya seed command automatic nahi chalti.

## 3. Kaunsi service ka link kholna hai

| Service | Use |
| --- | --- |
| `carbonsynq-university-frontend` | Isi ka Render URL browser mein kholein; `/auth/signin` login page hai |
| `carbonsynq-invoice-backend` | Invoice processing service; root URL par success JSON aayega |

Frontend mein backend URL aur server token Blueprint automatically set karta hai. URL ke end mein `/api` add na karein. Frontend environment mein `NEXT_PUBLIC_DEMO_MODE=true` hi rehna chahiye, kyunki supplied invoice backend mein university V2 APIs nahi hain.

Demo login:

- Email: `demo@carbonsynq.test`
- Password: `Demo@2026`
- Ya **Open university demo** button use karein.

Flow: login → onboarding → Activity Data → manual/Excel/invoice **Save & calculate** → updated dashboard. Pehli valid entry/import se pehle sample demo data dikhega.

## Agar backend already deployed hai

Naya backend banane ki zarurat nahi. Render par **New → Web Service** se isi repository ka frontend create karein:

| Setting | Value |
| --- | --- |
| Language/runtime | Node |
| Root Directory | `frontend` |
| Build Command | `npm ci --include=dev --no-audit --no-fund && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| `NODE_VERSION` | `24.19.0` |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_DEMO_MODE` | `true` |
| `INVOICE_BACKEND_URL` | Existing backend ka HTTPS root URL, without `/api` |
| `INVOICE_BACKEND_TIMEOUT_MS` | `180000` |

Agar existing backend par bearer token enabled hai, wahi `INVOICE_BACKEND_AUTH_TOKEN` frontend **server environment** mein set karein. Agar token enabled nahi hai, frontend par ise blank/unset rakhein.

## Manual backend setup / DB_HOST wale credentials

Render par **New → Web Service**, same repository:

| Setting | Value |
| --- | --- |
| Runtime | Docker |
| Root Directory | `backend` |
| Dockerfile Path | `./Dockerfile` |
| Docker Build Context | `.` |
| Docker Command | Blank; Dockerfile ka `npm start` use hoga |
| Health Check Path | `/` |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |

Environment page par working `.env` se Supabase, database aur extractor keys add karein. `DATABASE_URL` set ho to backend use prefer karta hai; otherwise `DB_HOST` etc. use honge. `DB_SSL=true` apne hosted Postgres ki requirement ke hisaab se copy karein. Server token ke liye apna long random `INVOICE_BACKEND_AUTH_TOKEN` backend aur frontend dono par same set karein. Health check public rahega; API requests token require karengi.

Optional settings bhi working backend se copy kar sakte hain: `GEMINI_MODEL`, `AFFINDA_API_KEY`, `AFFINDA_WORKSPACE_ID`, `AFFINDA_DOCUMENT_TYPE_ID`, `MISTRAL_API_KEY`, `MISTRAL_MODEL`, `CLIMATIQ_API_KEY`. Blueprint Gemini ko main provider maanta hai. Dusra working provider use karte hain to uski settings backend Environment mein add karke redeploy karein.

## Custom domain / demo se pehle quick check

- Custom frontend domain use karein to frontend environment mein `WORKSPACE_PUBLIC_URL=https://your-domain.example` set karke redeploy karein. Render ke default `onrender.com` URL par ye automatic hai.
- Backend root URL kholkar `success: true` JSON confirm karein.
- Frontend `/api/health` par `success: true` aur `/api/invoices/status` par `reachable: true` check karein. `reachable` sirf server connectivity batata hai; database/provider credentials ka invoice upload se check hoga.
- Login, onboarding, ek manual entry aur ek real invoice test karein. Unknown invoice factor ko calculated value nahi banaya jayega.
- Free Render service 15 minute idle hone par sleep hoti hai; wake-up lagbhag ek minute le sakta hai. Demo shuru karne se pehle dono links kholkar live hone dein. Paid compute sleep nahi karta; plan change apne Render dashboard se karein.

## Data ka behavior

University workspace/onboarding/manual/Excel/dashboard records abhi browser local storage mein save hote hain. Same browser aur same deployed URL par refresh ke baad persist hote hain. Dusra browser/device ya localhost se deployed domain par switch karne par alag demo workspace milega. Invoice extraction/calculation supplied backend aur uske configured Supabase/Postgres/providers se hoti hai. Shared university database aur production user accounts ke liye compatible V2 backend abhi bhi chahiye.

Backend report files default service filesystem par generate hote hain aur restart/redeploy ke baad permanent guarantee nahi hai. University demo reports frontend se downloadable PDF hain.

## Build checks apne computer par

Node 24 use karein. Dono folders mein `npm ci --include=dev` aur `npm run build` chalayein. Frontend tests: `npm run test:demo`, `npm run test:invoices`, `npm run test:onboarding`. Dono builds ke baad outer folder se `node scripts/test-deployment.mjs` run karein; is smoke test mein live database/provider calls nahi hoti hain.

Deployment references: [Next.js on Render](https://render.com/docs/deploy-nextjs-app), [Blueprint](https://render.com/docs/blueprint-spec), [monorepo paths](https://render.com/docs/monorepo-support), [environment variables](https://render.com/docs/configure-environment-variables), [Free service behavior](https://render.com/docs/free).
