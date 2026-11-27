FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.23.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json nx.json ./
COPY libs ./libs
COPY apps/dashboard ./apps/dashboard

ARG VITE_PRIMEUI_LICENSE_KEY=""
ARG VITE_DOCS_URL=""
ENV VITE_PRIMEUI_LICENSE_KEY=${VITE_PRIMEUI_LICENSE_KEY}
ENV VITE_DOCS_URL=${VITE_DOCS_URL}

RUN pnpm install --frozen-lockfile --filter @zeromttr/dashboard...
RUN pnpm --filter @zeromttr/utils --filter @zeromttr/contracts run build
RUN pnpm --filter @zeromttr/dashboard exec vite build

FROM nginx:alpine

ENV NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$

COPY apps/dashboard/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
