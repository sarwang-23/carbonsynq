# Node 24 satisfies the PDF.js and Puppeteer runtime requirements.
FROM node:24-bookworm-slim

# Reports use LibreOffice and Puppeteer. Canvas can fall back to a native build.
# System Chromium avoids a second browser download during npm installation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium libreoffice-writer \
    fonts-liberation fonts-croscore fonts-crosextra-carlito fonts-crosextra-caladea \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund \
    && mkdir -p generated reports uploads \
    && chown -R node:node /usr/src/app

ENV NODE_ENV=production PORT=10000
USER node
EXPOSE 10000
CMD ["npm", "start"]
