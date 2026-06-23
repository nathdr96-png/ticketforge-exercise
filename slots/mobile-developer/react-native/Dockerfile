# ---- build ----
# A React Native app bundled for the web. No Android SDK and no Xcode are
# involved, which is exactly the trade this slot makes: see README.md.
FROM node:20-bookworm-slim AS build
WORKDIR /app

# VITE_* values are inlined into the bundle, so the API URL is a build arg.
ARG VITE_API_BASE_URL=http://127.0.0.1:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json* .npmrc ./
RUN npm ci || npm install

COPY tsconfig.json vite.config.ts index.html app.json ./
COPY src ./src
RUN npm run build

# ---- serve ----
FROM node:20-bookworm-slim AS serve
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/vite.config.ts ./vite.config.ts
COPY --from=build /app/dist ./dist

EXPOSE 3000
# `vite preview` serves the built bundle on $PORT (see vite.config.ts).
CMD ["npx", "vite", "preview", "--host", "0.0.0.0"]
