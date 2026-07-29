# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# CAMERA_BASE is read at module load; the build only needs it to be set.
ENV CAMERA_BASE=/data/camera
RUN pnpm build

FROM node:24-bookworm-slim AS prod-deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
# perl runs the vendored exiftool that reads and writes the XMP metadata.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends perl \
	&& rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts ./
COPY scripts ./scripts

ENV NODE_ENV=production
ENV CAMERA_BASE=/data/camera
ENV PHOTOPIPE_DB=/data/index.db
EXPOSE 3000

CMD ["pnpm", "start"]
