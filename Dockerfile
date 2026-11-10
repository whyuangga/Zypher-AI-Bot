# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


# ---------- Runtime stage ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# font self-host dipakai dashboard (/fonts/general-sans-*.woff2)
COPY assets ./assets
COPY package.json ./

RUN mkdir -p /app/data && chown -R node:node /app

USER node
VOLUME ["/app/data"]

# Dashboard web (aktif hanya kalau DASHBOARD_TOKEN diisi)
EXPOSE 3000

CMD ["node", "dist/index.js"]
