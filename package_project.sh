#!/bin/bash

# --- CONFIGURACIÓN ---
# Nombre del proyecto, usado para el nombre del archivo ZIP.
PROJECT_NAME="dhcp-sentinel-backend"
# Genera el nombre del archivo de salida con la fecha actual (ej: dhcp-sentinel-backend_2025-10-13.zip)
OUTPUT_FILE="${PROJECT_NAME}_$(date +'%Y-%m-%d').zip"

# --- INICIO DEL SCRIPT ---

echo "==============================================="
echo " Empaquetando el proyecto DHCP Sentinel"
echo "==============================================="
echo

# Comprobar si ya existe un archivo con el mismo nombre y borrarlo.
if [ -f "$OUTPUT_FILE" ]; then
    echo "-> Se encontró un archivo de paquete antiguo. Eliminando '$OUTPUT_FILE'..."
    rm "$OUTPUT_FILE"
fi

echo "-> El paquete se guardará como: $OUTPUT_FILE"
echo

echo "-> Se excluirán los siguientes elementos:"
echo "   - El entorno virtual (venv/)"
echo "   - La base de datos (app.db)"
echo "   - Archivos de caché de Python (__pycache__/ y *.pyc)"
echo "   - El propio script de empaquetado"
echo "   - Cualquier otro archivo .zip"
echo

# El comando ZIP:
# -r : recursivo, para incluir todos los subdirectorios.
# "$OUTPUT_FILE" : el nombre de nuestro archivo de salida.
# . : el directorio actual (la raíz del proyecto).
# -x : para excluir los patrones que siguen.
zip -r "$OUTPUT_FILE" . \
    -x "venv/*" \
    -x "app.db" \
    -x "*/__pycache__/*" \
    -x "*.pyc" \
    -x "*.zip"

echo
echo "==============================================="
echo "¡Proceso completado!"
echo "El archivo '$OUTPUT_FILE' ha sido creado en el directorio actual."
echo "==============================================="
