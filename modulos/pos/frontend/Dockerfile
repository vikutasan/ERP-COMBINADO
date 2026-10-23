# Dockerfile del frontend del POS nuevo — FP-02.
#
# Build multi-etapa:
#   Etapa 1 (build): Node 20 compila el bundle de Vite con la URL del API
#                    inyectada como ARG de build (nunca hardcodeada).
#   Etapa 2 (serve): Nginx sirve el bundle estático en el puerto 80.
#
# Uso directo:
#   docker build \
#     --build-arg VITE_API_URL=http://localhost:5101 \
#     -t nuevo-pos-frontend:latest \
#     ./apps/pos
#
# Con docker-compose.prod.yml (recomendado):
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# ── Etapa 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copiar manifiestos primero → capa cacheada si no cambian dependencias.
COPY package.json package-lock.json ./

# Instalar dependencias (ci = reproducible, sin actualizar lock).
RUN npm ci

# Copiar el resto del código fuente.
COPY . .

# VITE_API_URL se inyecta en build-time. En producción Vite baja este valor
# al bundle; el contenedor NO necesita la variable en runtime.
ARG VITE_API_URL=http://localhost:5101
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ── Etapa 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

LABEL org.opencontainers.image.title="Nuevo POS Frontend"
LABEL org.opencontainers.image.description="Frontend del POS nuevo — R de Rico"

# Copiar el bundle compilado al directorio de Nginx.
COPY --from=build /app/dist /usr/share/nginx/html

# Configuración de Nginx (SPA-friendly: redirige todo a index.html).
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
