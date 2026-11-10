FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json nx.json ./
COPY libs ./libs
COPY apps/target-app-demo ./apps/target-app-demo

RUN pnpm install --frozen-lockfile --filter @zeromttr/target-app-demo...
RUN pnpm --filter @zeromttr/target-app-demo... run build

EXPOSE 3001
CMD ["node", "apps/target-app-demo/dist/main.js"]
