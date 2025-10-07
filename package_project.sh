#!/bin/bash

# --- Script para empaquetar el proyecto DHCP Sentinel para despliegue ---

# Nombre del directorio del proyecto (el directorio actual)
PROJECT_NAME="dhcp-sentinel-backend"
# Nombre del archivo de salida
OUTPUT_FILE="dhcp-sentinel-release.tar.gz"

echo "Creando paquete de despliegue: ${OUTPUT_FILE}..."

# Usamos 'tar' para crear un archivo comprimido (.tar.gz)
# --exclude-vcs: Excluye automáticamente carpetas de control de versiones como .git
# --exclude: Excluye patrones específicos que no queremos en el paquete final.

tar \
  --exclude-vcs \
  --exclude='venv' \
  --exclude='app.db' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='instance' \
  --exclude='*.tar.gz' \
  --exclude='package_project.sh' \
  -czvf "${OUTPUT_FILE}" \
  .

echo "-----------------------------------------------------"
echo "¡Paquete creado con éxito!"
echo "Archivo guardado como: ${OUTPUT_FILE}"
echo "Este archivo contiene solo el código fuente necesario para el despliegue."
echo "-----------------------------------------------------"
