FROM node:22-bookworm-slim

# Dépendances système pour Chromium, WebRTC, Xvfb, et audio FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    xauth \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/bot

# Copie des définitions de paquets
COPY bot/package*.json ./
RUN npm install

# Installation de Chromium via Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

COPY bot/ ./
RUN npm run build

# Utilisateur système non-root
RUN useradd -m -s /bin/bash botuser && chown -R botuser:botuser /app/bot /ms-playwright
USER botuser

EXPOSE 5001
ENV PORT=5001
ENV NODE_ENV=production

# Exécution sous écran virtuel Xvfb pour maintenir le moteur WebRTC actif
CMD ["xvfb-run", "-a", "-s", "-screen 0 1280x720x24", "node", "dist/index.js"]
