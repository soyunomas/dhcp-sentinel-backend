# DHCP Sentinel

DHCP Sentinel es una aplicación web basada en Flask diseñada para monitorear y gestionar las concesiones (leases) de DHCP en una red local. Proporciona una interfaz amigable para rastrear los dispositivos conectados, ver su estado y liberar proactivamente concesiones de IP para prevenir el agotamiento del pool de direcciones DHCP.

## Características

-   **Panel de Control Centralizado**: Un dashboard limpio que muestra una lista ordenable y con búsqueda de todos los dispositivos descubiertos, junto con estadísticas clave (total de dispositivos, activos, IPs liberadas).
-   **Descubrimiento Activo de Dispositivos**: Escanea la red periódicamente usando Nmap para descubrir hosts activos, sus direcciones MAC y fabricantes, manteniendo la lista de dispositivos siempre actualizada.
-   **Liberación Manual de IP**: Fuerza un `DHCPRELEASE` para la IP de cualquier dispositivo directamente desde la interfaz de usuario, ideal para acciones inmediatas.
-   **Automatización Inteligente de Liberación**:
    -   **Por Inactividad**: Libera automáticamente las IPs de dispositivos que han estado inactivos durante un número de horas definido por el usuario.
    -   **Por Lista de MACs**: Libera automáticamente las IPs de dispositivos cuya dirección MAC coincide con una lista configurable (útil para dispositivos de invitados o IoT que no necesitan una IP permanente).
-   **Exclusión de Dispositivos Críticos**: Protege equipos importantes (como servidores, impresoras o puntos de acceso) marcándolos como "excluidos" para que nunca sean afectados por las acciones de liberación automática.
-   **Acceso Seguro**: Toda la aplicación está protegida por un sistema de login con usuario y contraseña.
-   **Registro de Eventos**: Todas las acciones importantes (escaneos, liberaciones manuales y automáticas, errores) se registran y se pueden visualizar dentro de la aplicación.
-   **Modo Simulación (Dry Run)**: Permite ejecutar la aplicación en un modo seguro que registra las acciones que *tomaría* sin ejecutarlas realmente, perfecto para pruebas y configuración inicial.

## Lógica de Funcionamiento

El sistema opera con dos componentes principales: la **Interfaz Web** (manejada por Flask) y un **Worker en Segundo Plano** (`scanner_worker.py`).

-   La **Interfaz Web** te permite ver el estado de la red y realizar acciones manuales inmediatas.
-   El **Worker en Segundo Plano** es el motor de la automatización. Se ejecuta en un bucle constante para descubrir dispositivos y aplicar las reglas de liberación que hayas configurado.

### El Ciclo del Worker (cada 60 segundos)

El `scanner_worker.py` realiza las siguientes tareas en cada ciclo:

1.  **Fase de Descubrimiento**: Lanza un escaneo Nmap en la subred configurada para encontrar dispositivos activos.
2.  **Fase de Sincronización**: Actualiza la base de datos con los dispositivos encontrados. Si un dispositivo conocido es visto, se actualiza su marca de tiempo `last_seen`. Si es un dispositivo nuevo, se añade a la base de datos.
3.  **Fase de Automatización**: Revisa la lista de dispositivos y aplica las reglas de liberación automática (ver tabla abajo).

### Acciones Manuales (Desde la Interfaz Web)

Estas son acciones que tú inicias y que tienen efecto inmediato.

| Acción | Activación | Resultado Inmediato |
| :--- | :--- | :--- |
| **Liberar IP** | Clic en el botón **"Liberar"** de un dispositivo. | El sistema envía **inmediatamente** un paquete `DHCPRELEASE` para esa IP. |
| **Excluir Dispositivo** | Clic en el botón **"Excluir"** de un dispositivo. | El dispositivo queda **protegido** de todas las acciones automáticas. |
| **Incluir Dispositivo** | Clic en el botón **"Incluir"** de un dispositivo excluido. | El dispositivo vuelve a ser un **candidato** para las acciones automáticas. |

### Lógica de Automatización (Realizada por el Worker)

Estas son las reglas que el worker aplica automáticamente en cada ciclo.

| Criterio | Condición para Actuar | Aclaración Importante |
| :--- | :--- | :--- |
| **Liberación por Inactividad** | Un dispositivo **no excluido** no ha sido visto (`last_seen`) en más tiempo que el umbral de horas configurado. | La opción "Liberar IPs inactivas después de (horas)" debe ser mayor que 0. |
| **Liberación por Lista de MACs**| La MAC de un dispositivo **no excluido** coincide con una entrada en la lista de MACs para liberación automática. | Esta regla se aplica **incluso si el dispositivo está activo**. Es útil para dispositivos de "usar y tirar". |
| **Rol de la Exclusión** | El dispositivo tiene el estado `is_excluded = true`. | **Un dispositivo excluido está protegido y es IGNORADO por todas las reglas de automatización.** |

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
