# Dockerfile del API del POS — ERP COMBINADO (FASE 1).
#
# PARA PRODUCCIÓN Y CI. No usar en desarrollo local: el docker-compose.yml
# usa `python:3.12-slim` + volumen montado + `--reload` para que los cambios
# en el host se reflejen sin reconstruir la imagen.
#
# Por qué una imagen propia en vez de `python:3.12-slim` con pip en startup:
#   - Las dependencias se instalan UNA VEZ al construir, no en cada arranque.
#   - El tiempo de startup del contenedor baja de ~40s a ~2s.
#   - La imagen es reproducible: el mismo tag siempre tiene las mismas deps.
#   - En CI, la capa de deps se cachea entre corridas (si requirements.txt no cambia).
#
# Uso:
#   docker build -t erp-combinado-pos-api:latest ./modulos/pos/api
#   docker run -e DATABASE_URL=... -p 5211:5211 erp-combinado-pos-api:latest
#
# Con docker-compose.prod.yml:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

FROM python:3.12-slim

# Metadatos
LABEL org.opencontainers.image.title="ERP Combinado POS API"
LABEL org.opencontainers.image.description="API del POS — ERP COMBINADO R de Rico"

# Variables de entorno para Python en contenedor
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 1. Instalar dependencias primero (capa cacheada si requirements.txt no cambia).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. Copiar el código de la aplicación.
#    Se copia DESPUÉS de las deps para aprovechar la caché de Docker layers:
#    cambiar el código no invalida la capa de dependencias.
COPY . .

# Puerto del API del POS dentro del rango del ERP COMBINADO (5200-5241).
# No colisiona con producción (5000/5001) ni con NUEVO-ERP (5100/5101).
EXPOSE 5211

# Producción: sin --reload. El código está en la imagen, no en un volumen.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5211", "--workers", "2"]
