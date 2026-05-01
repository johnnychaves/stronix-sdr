# Dockerfile pro Railway — controle determinístico do ambiente.
# Necessário porque Nixpacks (default do Railway) não estava instalando
# ffmpeg via [phases.setup], e ffmpeg é obrigatório pro transcoding
# webm→ogg de áudio enviado pelo painel.

FROM node:20-slim

# ─── System deps ───
# - ffmpeg: transcoding webm→ogg (Chrome MediaRecorder → WhatsApp Cloud API)
# - build-essential + python3: pra compilar better-sqlite3 (native)
# - ca-certificates: HTTPS calls (Meta API, Anthropic)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      build-essential \
      python3 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ─── Install JS deps (layer cache) ───
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ─── App code ───
COPY . .

# Railway injeta PORT na env; default 8080 (mesmo do config.js)
ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
