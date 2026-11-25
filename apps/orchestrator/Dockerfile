FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@12.23.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json nx.json ./
COPY libs ./libs
COPY data ./data
COPY apps/orchestrator ./apps/orchestrator

RUN pnpm install --frozen-lockfile --filter @zeromttr/orchestrator...
RUN pnpm --filter @zeromttr/orchestrator... run build

EXPOSE 8080
CMD ["node", "apps/orchestrator/dist/main.js"]
