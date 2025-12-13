FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./

# Update to patched versions before install
RUN sed -i 's/"next": "16.0.3"/"next": "16.0.7"/' package.json && \
    sed -i 's/"react": "19.2.0"/"react": "19.2.1"/' package.json && \
    sed -i 's/"react-dom": "19.2.0"/"react-dom": "19.2.1"/' package.json

RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during the runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files for custom server
# We need full node_modules for the custom server because standalone mode doesn't support custom servers well without extra config
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server-voice.mjs ./server-voice.mjs
COPY --from=builder /app/lib ./lib

USER nextjs

EXPOSE 3000

ENV PORT 3000

# Use tsx to run server-voice.mjs to support TypeScript imports in the server file
CMD ["npx", "tsx", "server-voice.mjs"]
