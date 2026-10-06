#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/frontend"
npm ci
printf '%s\n' 'Open http://localhost:3000/auth/signin and click Open university demo.'
npm run dev -- --hostname 127.0.0.1
