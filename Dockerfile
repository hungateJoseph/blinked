# Build and run the app as a small production image.
#
# Node 22 is the minimum better-sqlite3 supports. Debian ("slim") rather than
# Alpine on purpose: sharp's prebuilt binaries target glibc, and musl would
# force it to be built from source too.

# --- 1. Install dependencies ------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
# better-sqlite3 publishes no prebuilt binary for every Node/architecture pair,
# so it is compiled here. These tools exist only in this stage — the final
# image below carries none of them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Build -----------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Skip Next.js telemetry in CI/build environments.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- 3. Run -------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Written to the mounted disk, not the container's temporary filesystem.
    DATA_DIR=/var/data/db \
    UPLOAD_DIR=/var/data/uploads

# `output: "standalone"` in next.config.ts produces a server that carries its
# own traced dependencies, so the full node_modules tree is not copied here.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# The standalone output does NOT include public/, and it must be copied by
# hand. It holds the face-recognition model weights, which the browser fetches
# from this origin — without this they 404 and face matching silently fails.
COPY --from=builder /app/public ./public

EXPOSE 3000

# The database and uploads live under /var/data, which the host mounts as a
# disk that survives redeploys. Creating them here keeps a first run working
# even when no disk is attached (useful for a local smoke test of this image).
CMD ["sh", "-c", "mkdir -p \"$DATA_DIR\" \"$UPLOAD_DIR\" && exec node server.js"]
