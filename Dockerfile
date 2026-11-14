# Web app image: one Node process serves the API, the scheduler and the React build.
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
ENV npm_config_fetch_retries=5 npm_config_fetch_timeout=120000
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

FROM ${NODE_IMAGE} AS runtime
ENV npm_config_fetch_retries=5 npm_config_fetch_timeout=120000
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    AUTH_MODE=easy-auth \
    DB_PATH=/data/monitor.db
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY public ./public
# Mount the real integrations at /app/integrations; the examples are a demo default.
COPY examples/integrations ./integrations
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "dist/main/serve.js", "integrations"]
