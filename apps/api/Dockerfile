# Imagen del backend (apps/api). Se construye desde la raíz del repo:
#   docker build -f apps/api/Dockerfile -t b20-api .
# Las variables de entorno (OIDC_AUDIENCE, BYOK_ENCRYPTION_KEY, GEMINI_MODEL, CORS_ORIGINS…)
# se pasan al desplegar; nunca se copian a la imagen.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @b20/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w @b20/api

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w @b20/api --omit=dev --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
USER node
# Cloud Run y la mayoría de los servicios asignan PORT; 8787 es el valor local.
ENV PORT=8787
EXPOSE 8787
CMD ["node", "dist/server.js"]
