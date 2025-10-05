# DHCP Sentinel

DHCP Sentinel es una aplicación web basada en Flask diseñada para monitorear y gestionar las concesiones (leases) de DHCP en una red local. Proporciona una interfaz amigable para rastrear los dispositivos conectados, ver su estado y liberar proactivamente concesiones de IP para prevenir el agotamiento del pool de direcciones DHCP.

## Características

-   **Descubrimiento de Dispositivos de Red**: Escanea automáticamente la red usando Nmap para descubrir hosts activos, sus direcciones MAC y fabricantes.
-   **Panel de Control y Estadísticas**: Un dashboard limpio que muestra una lista ordenable y con búsqueda de todos los dispositivos descubiertos, junto con estadísticas clave (total de dispositivos, activos, IPs liberadas).
-   **Liberación Manual de DHCP**: Fuerza un `DHCPRELEASE` para la IP de cualquier dispositivo directamente desde la interfaz de usuario.
-   **Liberación Automatizada de IP**:
    -   **Por Inactividad**: Libera automáticamente las IPs de dispositivos que han estado inactivos durante un número de horas definido por el usuario.
    -   **Por Lista de MACs**: Libera automáticamente las IPs de dispositivos cuya dirección MAC coincide con una lista configurable (útil para dispositivos de invitados o IoT).
-   **Exclusión de Dispositivos**: Marca dispositivos críticos (como servidores o impresoras) como "excluidos" para protegerlos de las acciones de liberación automática.
-   **Acceso Seguro**: Toda la aplicación está protegida por un sistema de login con usuario y contraseña.
-   **Registro de Eventos**: Todas las acciones importantes (escaneos, liberaciones, errores) se registran y se pueden visualizar dentro de la aplicación.

## Tecnologías Utilizadas

-   **Backend**: Flask, SQLAlchemy, Flask-Login, Flask-Bcrypt
-   **Redes**: Scapy, python-nmap
-   **Base de Datos**: SQLite (a través de Flask-SQLAlchemy y Flask-Migrate)
-   **Frontend**: Bootstrap 5, Day.js

## Instrucciones de Instalación

Sigue estos pasos para configurar y ejecutar el proyecto en un sistema Linux basado en Debian (como Ubuntu).

### 1. Prerrequisitos

Primero, asegúrate de tener Git, Python y Nmap instalados en tu sistema.

```bash
sudo apt update
sudo apt install -y git python3 python3-pip python3-venv nmap
```

### 2. Clonar el Repositorio

Clona este repositorio en tu máquina local.

```bash
git clone https://github.com/soyunomas/dhcp-sentinel-backend.git
cd dhcp-sentinel-backend
```

### 3. Configurar el Entorno de Python

Crea y activa un entorno virtual para gestionar las dependencias.

```bash
# Crea el entorno virtual
python3 -m venv venv

# Actívalo
source venv/bin/activate
```

### 4. Instalar Dependencias

Instala todas las librerías de Python requeridas desde el archivo `requirements.txt`.

```bash
pip install -r requirements.txt
```

### 5. Configurar la Base de Datos

Aplica las migraciones de la base de datos para crear el archivo `app.db` con el esquema correcto.

```bash
# Exporta la variable de entorno de Flask
export FLASK_APP=run.py

# Aplica las migraciones
flask db upgrade
```

### 6. Crear el Usuario Administrador

Necesitas crear el usuario administrador inicial para poder iniciar sesión. Ejecuta el shell de Flask y los siguientes comandos de Python.

```bash
# Inicia el shell
flask shell
```

Ahora, dentro de la consola de Python:
```python
# Importa los módulos necesarios
from app import db
from app.models import User

# Crea una nueva instancia de usuario (puedes cambiar 'admin' si lo deseas)
u = User(username='admin')

# Establece una contraseña segura (REEMPLAZA 'tu_contraseña_segura' con tu contraseña real)
u.set_password('tu_contraseña_segura')

# Añade a la sesión de la base de datos y confirma los cambios
db.session.add(u)
db.session.commit()

# Sal del shell
exit()
```

## Ejecutando la Aplicación

La aplicación requiere que dos procesos se ejecuten en dos terminales diferentes, ambos con privilegios `sudo` para operaciones de red.

### Terminal 1: Ejecutar el Servidor Web

```bash
# Asegúrate de que tu entorno virtual está activo
source venv/bin/activate

# Inicia el servidor web de Flask
sudo venv/bin/python run.py
```
Esto hará que la interfaz web esté disponible en `http://<ip-de-tu-servidor>:5001`.

### Terminal 2: Ejecutar el Worker de Escaneo

```bash
# Asegúrate de que tu entorno virtual está activo
source venv/bin/activate

# Inicia el worker de escaneo y automatización en segundo plano
sudo venv/bin/python scanner_worker.py
```
Este proceso se encargará del descubrimiento de dispositivos y las liberaciones automáticas de IP.

### Configuración Final

1.  Abre tu navegador web y navega a `http://127.0.0.1:5001`.
2.  Inicia sesión con el nombre de usuario y la contraseña que creaste en el paso 6.
3.  Ve a la pestaña **"Configuración"**.
4.  **Crucialmente, actualiza los parámetros de red** (Subred a Escanear, IP del Servidor DHCP y especialmente la **Interfaz de Red**) para que coincidan con la configuración de tu red.
5.  Guarda los cambios. La aplicación ya está completamente operativa.
