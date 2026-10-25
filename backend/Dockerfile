# Backend runtime image. Deployment portability only; local development does not need Docker.
# Build from the repository root (the backend depends on the shared workspace package):
#   docker build -f backend/Dockerfile -t cultural-elasticity-api .
#   docker run --rm -p 4000:4000 --env-file backend/.env cultural-elasticity-api
# The image contains no credentials. Supply QLOO_API_KEY and QLOO_API_BASE_URL (https://hackathon.api.qloo.com) at runtime only.
# The official Qloo harness (stdio MCP / exec) runs inside this container, which is why the backend
# targets a container-capable runtime rather than browser or ordinary serverless execution.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend
RUN pnpm install --frozen-lockfile --filter backend... \
 && pnpm --filter backend build \
 && pnpm --filter backend deploy --prod --legacy /out \
 && cp -r backend/dist /out/dist \
 && cp -r backend/migrations /out/migrations

FROM node:22-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
