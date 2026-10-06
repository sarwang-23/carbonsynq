#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/backend"
if [[ ! -f .env ]]; then
  printf '%s\n' 'Copy your WORKING backend .env into backend/.env first.' 'If the backend already runs on port 5000, start only start-demo.sh.'
  exit 1
fi
if [[ ! -x node_modules/.bin/tsx ]]; then npm ci; fi
printf '%s\n' 'Starting the invoice backend on its configured port, normally 5000.'
npm run dev
