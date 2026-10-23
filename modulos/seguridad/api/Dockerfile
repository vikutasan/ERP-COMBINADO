# Imagen de la API de Seguridad y Acceso — FASE 3.1.
#
# Este módulo es autónomo (RT-09): tiene su propio Dockerfile, su propio
# contenedor y su propia base de datos. No comparte imagen ni volumen con el
# POS ni con ningún otro módulo.
#
# En desarrollo el código se monta como volumen (ver docker-compose.yml), así
# que la imagen solo aporta el intérprete y las dependencias. En producción se
# copia el código y se ejecuta sin --reload.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencias primero: así el layer se cachea y no se reinstala en cada cambio
# de código.
COPY requirements.txt ./
RUN pip install --quiet --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5229

# Sin --reload: la recarga en caliente la aporta el `command:` de compose en
# desarrollo. Aquí el contenedor arranca tal cual para producción.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5229"]
