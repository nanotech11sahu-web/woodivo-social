# Woodivo Social Publisher - Docker deployment
# Render's default Node build environment has no ffmpeg/ffprobe binaries and
# no way to apt-get them in - Docker is the reliable path to get both onto
# the image the video pipeline (VideoProcessorService) needs.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# ffmpeg provides both the ffmpeg and ffprobe binaries fluent-ffmpeg needs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/main.js"]
