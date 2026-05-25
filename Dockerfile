# Stage 1: Install dependencies
FROM node:24.16.0-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM node:24.16.0-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV CAMERA_BASE=/data/camera
RUN pnpm build

# Stage 3: Production image
FROM node:24.16.0-alpine
# vips is required by sharp for image processing
RUN apk add --no-cache vips
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
ENV CAMERA_BASE=/data/camera
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "build/index.js"]
