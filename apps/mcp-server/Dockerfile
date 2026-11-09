FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json nx.json ./
COPY apps/mcp-server ./apps/mcp-server

RUN pnpm install --frozen-lockfile --filter @zeromttr/mcp-server...
RUN pnpm --filter @zeromttr/mcp-server run build

EXPOSE 8000
CMD ["node", "apps/mcp-server/dist/main.js"]
