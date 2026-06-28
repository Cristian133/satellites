# Stage 1 — Build Angular frontend
FROM node:22-alpine AS fe-builder
WORKDIR /build
COPY satellites-fe/package*.json ./
RUN npm ci
COPY satellites-fe/ .
RUN npm run build

# Stage 2 — nginx: serve FE + proxy to BE
FROM nginx:alpine
COPY --from=fe-builder /build/dist/satellites-frontend /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
