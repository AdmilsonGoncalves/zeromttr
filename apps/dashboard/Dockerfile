FROM nginx:alpine

ENV NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$

COPY apps/dashboard/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/dashboard/src /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
