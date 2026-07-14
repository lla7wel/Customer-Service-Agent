# English Home Libya platform — production image.
# Build from the REPO ROOT (admin-app imports ../integrations):
#   docker build -t eh-platform .
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY admin-app/package.json admin-app/package-lock.json ./admin-app/
RUN npm ci --ignore-scripts && cd admin-app && npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/admin-app/node_modules ./admin-app/node_modules
COPY package.json ./
COPY integrations ./integrations
COPY admin-app ./admin-app
RUN cd admin-app && npx next build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /srv/eh-media && chown app:app /srv/eh-media
# Standalone output is rooted at the repo root (outputFileTracingRoot).
COPY --from=build /repo/admin-app/.next/standalone ./
COPY --from=build /repo/admin-app/.next/static ./admin-app/.next/static
COPY --from=build /repo/admin-app/public ./admin-app/public
USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "admin-app/server.js"]
