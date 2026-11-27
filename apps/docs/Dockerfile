FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.23.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json nx.json ./
COPY apps/docs ./apps/docs

ARG ZEROMTTR_DOCS_URL="https://docs.zeromttr.agjworks.com"
ARG PUBLIC_DASHBOARD_URL="https://zeromttr.agjworks.com"
ENV ZEROMTTR_DOCS_URL=${ZEROMTTR_DOCS_URL}
ENV PUBLIC_DASHBOARD_URL=${PUBLIC_DASHBOARD_URL}

RUN pnpm install --frozen-lockfile --filter @zeromttr/docs...
RUN pnpm --filter @zeromttr/docs run build

FROM nginx:alpine

COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/docs/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
