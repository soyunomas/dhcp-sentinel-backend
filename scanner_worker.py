# scanner_worker.py

import time
from datetime import datetime, timedelta, UTC, date as date_obj
from sqlalchemy import or_

from app import create_app, db
from app.models import ApplicationConfig, Device, HistoricalStat
from app.scanner.core import discover_hosts, sync_devices_db, log_event, perform_dhcp_release

# --- CONFIGURACIÓN DEL WORKER ---
SCAN_INTERVAL_SECONDS = 60 
INACTIVE_THRESHOLD_MINUTES = 5 # Umbral para considerar un dispositivo inactivo
# --------------------------------

# Diccionario en memoria para mantener las estadísticas del día actual
daily_stats = {}

def reset_daily_stats():
    """Inicializa o resetea los contadores de estadísticas para el día actual."""
    global daily_stats
    today = date_obj.today()
    print(f"[*] Reseteando contadores de estadísticas para el día {today.isoformat()}")
    daily_stats = {
        "date": today,
        "releases_inactivity": 0,
        "releases_mac_list": 0,
        "active_devices_peak": 0
    }

def commit_daily_stats():
    """
    Guarda las estadísticas acumuladas del día anterior en la base de datos.
    """
    global daily_stats
    
    date_to_commit = daily_stats.get("date")
    if not date_to_commit:
        print("[!] No hay estadísticas diarias para guardar.")
        return

    try:
        print(f"[*] Guardando estadísticas para la fecha {date_to_commit.isoformat()} en la base de datos...")
        
        stat_entry = db.session.get(HistoricalStat, date_to_commit)
        if not stat_entry:
            stat_entry = HistoricalStat(date=date_to_commit)
            db.session.add(stat_entry)
        
        # --- BLOQUE CORREGIDO: Manejo robusto de valores None ---
        # Si el valor de la BD es None, lo tratamos como 0 antes de sumar.
        stat_entry.releases_inactivity = (stat_entry.releases_inactivity or 0) + daily_stats.get("releases_inactivity", 0)
        stat_entry.releases_mac_list = (stat_entry.releases_mac_list or 0) + daily_stats.get("releases_mac_list", 0)
        
        # Esta línea ya era robusta, pero la mantenemos consistente
        stat_entry.active_devices_peak = max(
            stat_entry.active_devices_peak or 0,
            daily_stats.get("active_devices_peak", 0)
        )
        # --- FIN DE LA CORRECCIÓN ---

        stat_entry.total_devices_snapshot = Device.query.count()

        db.session.commit()
        print(f"[OK] Estadísticas para {date_to_commit.isoformat()} guardadas.")

    except Exception as e:
        print(f"[!!!] ERROR al guardar estadísticas diarias para {date_to_commit.isoformat()}: {e}")
        db.session.rollback()
        log_event(f"Error al guardar estadísticas diarias para {date_to_commit.isoformat()}: {e}", "ERROR")
        db.session.commit()

def update_inactive_devices_status():
    """Actualiza el estado visual de los dispositivos a 'inactive'."""
    print("[*] Actualizando estado de dispositivos inactivos...")
    try:
        threshold = datetime.now(UTC) - timedelta(minutes=INACTIVE_THRESHOLD_MINUTES)
        devices_to_update = Device.query.filter(
            Device.status == 'active',
            Device.last_seen < threshold
        ).all()
        if devices_to_update:
            for device in devices_to_update:
                device.status = 'inactive'
            db.session.commit()
            print(f"[OK] Se marcaron {len(devices_to_update)} dispositivo(s) como inactivos.")
        else:
            print("[*] No se encontraron dispositivos para marcar como inactivos.")
    except Exception as e:
        print(f"[!!!] ERROR al actualizar estados a inactivo: {e}")
        db.session.rollback()

def run_scan_cycle(app_config):
    """Realiza un ciclo de escaneo y actualiza el pico de activos del día."""
    global daily_stats
    print("--- Iniciando nuevo ciclo de escaneo ---")
    
    if not app_config.scan_subnet:
        print("[!] La subred de escaneo no está configurada. Saltando ciclo.")
        return

    discovered_hosts = discover_hosts(app_config.scan_subnet)
    
    if discovered_hosts is not None:
        # Actualizar el pico de dispositivos activos para el día
        current_active_count = len(discovered_hosts)
        if current_active_count > daily_stats.get("active_devices_peak", 0):
            daily_stats["active_devices_peak"] = current_active_count
            print(f"[*] Nuevo pico de dispositivos activos hoy: {current_active_count}")

        sync_devices_db(discovered_hosts)

def run_auto_release_cycle(app_config):
    """Ejecuta la lógica de liberación automática e incrementa contadores."""
    global daily_stats
    print("--- [!] Iniciando ciclo de liberación automática ---")
    
    if app_config.dry_run_enabled:
        print("--- [!] MODO DRY RUN ACTIVADO: Solo se simularán las acciones. ---")
    
    # Criterio 1: Liberación por inactividad
    threshold_hours = app_config.auto_release_threshold_hours
    if threshold_hours > 0:
        time_threshold = datetime.now(UTC) - timedelta(hours=threshold_hours)
        inactive_devices = Device.query.filter(
            Device.is_excluded == False,
            Device.status != 'released',
            Device.last_seen < time_threshold
        ).all()
        if inactive_devices:
            print(f"[*] Encontrados {len(inactive_devices)} dispositivo(s) por inactividad prolongada.")
            for device in inactive_devices:
                process_release(device, app_config, release_type='inactivity')
    
    # Criterio 2: Liberación por lista de MACs
    mac_list_str = app_config.mac_auto_release_list or ""
    mac_prefixes = [mac.strip().upper() for mac in mac_list_str.splitlines() if mac.strip()]
    if mac_prefixes:
        mac_conditions = [Device.mac_address.startswith(prefix) for prefix in mac_prefixes]
        mac_matched_devices = Device.query.filter(
            Device.is_excluded == False,
            Device.status != 'released',
            or_(*mac_conditions)
        ).all()
        if mac_matched_devices:
            print(f"[*] Encontrados {len(mac_matched_devices)} dispositivo(s) por coincidencia de MAC.")
            for device in mac_matched_devices:
                process_release(device, app_config, release_type='mac_list')

def process_release(device, app_config, release_type):
    """Procesa una única liberación, actualizando el estado y las estadísticas."""
    global daily_stats
    log_msg = f"Candidato para liberación por '{release_type}': MAC {device.mac_address}, IP {device.ip_address}."
    log_event(log_msg, 'INFO')
    db.session.commit()
    
    success, was_dry_run = perform_dhcp_release(
        target_ip=device.ip_address, target_mac=device.mac_address,
        dhcp_server_ip=app_config.dhcp_server_ip, interface=app_config.network_interface,
        dry_run_enabled=app_config.dry_run_enabled
    )
    
    if success and not was_dry_run:
        device.status = 'released'
        log_event(f"IP {device.ip_address} liberada automáticamente por '{release_type}'.", 'INFO')
        
        # Incrementar el contador correspondiente
        if release_type == 'inactivity':
            daily_stats["releases_inactivity"] += 1
        elif release_type == 'mac_list':
            daily_stats["releases_mac_list"] += 1
            
        db.session.commit()
    elif not success:
        log_event(f"Falló el intento de liberación automática para la IP {device.ip_address}", 'ERROR')
        db.session.commit()
    time.sleep(1)


if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        log_event("Iniciando el worker de escaneo y automatización.")
        db.session.commit()

        reset_daily_stats()

        while True:
            try:
                # Comprobar si el día ha cambiado
                if date_obj.today() != daily_stats["date"]:
                    commit_daily_stats() # Guarda las stats del día que acaba de terminar
                    reset_daily_stats()  # Resetea para el nuevo día

                config = ApplicationConfig.get_settings()
                
                update_inactive_devices_status()
                run_scan_cycle(config)
                
                # La lógica de liberación automática se ejecuta en cada ciclo para mayor reactividad
                run_auto_release_cycle(config)

                print(f"--- Ciclo finalizado. Esperando {SCAN_INTERVAL_SECONDS} segundos... ---\n")
                time.sleep(SCAN_INTERVAL_SECONDS)

            except KeyboardInterrupt:
                print("\n[*] Deteniendo el worker... Guardando estadísticas finales.")
                commit_daily_stats() # Intenta guardar las stats antes de salir
                log_event("El worker de escaneo y automatización ha sido detenido.")
                db.session.commit()
                break
            except Exception as e:
                error_msg = f"Error crítico en el bucle principal del worker: {e}"
                print(f"[!!!] {error_msg}")
                log_event(error_msg, level='ERROR')
                db.session.commit()
                time.sleep(SCAN_INTERVAL_SECONDS * 2)
