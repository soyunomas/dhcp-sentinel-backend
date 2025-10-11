# scanner_worker.py

import time
from datetime import datetime, timedelta, UTC
from sqlalchemy import or_

from app import create_app, db
from app.models import ApplicationConfig, Device
from app.scanner.core import discover_hosts, sync_devices_db, log_event, perform_dhcp_release

# --- CONFIGURACIÓN DEL WORKER ---
SCAN_INTERVAL_SECONDS = 60 
INACTIVE_THRESHOLD_MINUTES = 5 # Umbral para considerar un dispositivo inactivo
# --------------------------------

def update_inactive_devices_status():
    """
    *** Propósito: Actualización de Estado Visual ***
    Esta función actualiza el estado de los dispositivos a 'inactive' si no han sido 
    vistos recientemente. Su única finalidad es proporcionar una representación visual 
    precisa en el frontend (insignia verde vs. amarilla).
    ESTA FUNCIÓN NO DESENCADENA NINGUNA ACCIÓN DE LIBERACIÓN DE IP.
    """
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
        log_event(f"Error al actualizar el estado de los dispositivos inactivos: {e}", "ERROR")
        db.session.commit()


def run_scan_cycle(app_config):
    """
    Realiza un ciclo completo de escaneo y sincronización con la base de datos.
    """
    print("--- Iniciando nuevo ciclo de escaneo ---")
    
    if not app_config.scan_subnet:
        print("[!] La subred de escaneo no está configurada. Saltando ciclo.")
        return

    discovered_hosts = discover_hosts(app_config.scan_subnet)
    
    if discovered_hosts is not None:
        sync_devices_db(discovered_hosts)

def run_auto_release_cycle(app_config):
    """
    *** Propósito: Lógica de Automatización de Liberación de IPs ***
    Busca dispositivos para liberar automáticamente basado en reglas de negocio de largo plazo.
    La lógica aquí es independiente del estado 'inactive' y se basa únicamente en el umbral 
    de horas configurado por el usuario o en la lista de MACs.
    """
    print("--- [!] Iniciando ciclo de liberación automática programado ---")
    
    if app_config.dry_run_enabled:
        print("--- [!] MODO DRY RUN ACTIVADO: Solo se simularán las acciones. ---")
    
    candidates_to_release = set()

    # --- Criterio 1: Liberación por inactividad a largo plazo ---
    threshold_hours = app_config.auto_release_threshold_hours
    if threshold_hours > 0:
        time_threshold = datetime.now(UTC) - timedelta(hours=threshold_hours)
        inactive_devices = Device.query.filter(
            Device.is_excluded == False,
            Device.status != 'released',
            Device.last_seen < time_threshold # <-- La condición clave es el timestamp, no el estado
        ).all()
        if inactive_devices:
            print(f"[*] Encontrados {len(inactive_devices)} dispositivo(s) por inactividad prolongada.")
            candidates_to_release.update(inactive_devices)
    else:
        print("[*] La liberación por inactividad está desactivada.")

    # --- Criterio 2: Liberación por lista de MACs ---
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
            candidates_to_release.update(mac_matched_devices)
    else:
        print("[*] La lista de MACs para liberación está vacía.")
    
    # --- Procesamiento de los candidatos ---
    if not candidates_to_release:
        print("[*] No se encontraron dispositivos para liberar automáticamente en este ciclo.")
        return

    print(f"[!] Se encontraron {len(candidates_to_release)} candidato(s) en total para liberar.")
    
    for device in candidates_to_release:
        log_msg = (
            f"Dispositivo candidato para liberación: MAC {device.mac_address}, "
            f"IP {device.ip_address}. Última vez visto: {device.last_seen.strftime('%Y-%m-%d %H:%M:%S')} UTC. "
            f"Procediendo a liberar IP."
        )
        log_event(log_msg, 'INFO')
        db.session.commit()
        
        success, was_dry_run = perform_dhcp_release(
            target_ip=device.ip_address,
            target_mac=device.mac_address,
            dhcp_server_ip=app_config.dhcp_server_ip,
            interface=app_config.network_interface,
            dry_run_enabled=app_config.dry_run_enabled
        )
        
        if success:
            if not was_dry_run:
                device.status = 'released'
                db.session.commit()
                log_event(f"IP {device.ip_address} liberada automáticamente.", 'INFO')
                db.session.commit()
        else:
            log_event(f"Falló el intento de liberación automática para la IP {device.ip_address}", 'ERROR')
            db.session.commit()
        
        time.sleep(1)


if __name__ == '__main__':
    app = create_app()
    
    with app.app_context():
        log_event("Iniciando el worker de escaneo y automatización.")
        db.session.commit()

        last_release_check_time = datetime.now(UTC) - timedelta(days=1)

        while True:
            try:
                current_time = datetime.now(UTC)
                config = ApplicationConfig.get_settings()

                update_inactive_devices_status()
                
                run_scan_cycle(config)

                release_interval_hours = config.auto_release_threshold_hours
                mac_list_is_configured = config.mac_auto_release_list.strip() != ""
                
                if release_interval_hours > 0 or mac_list_is_configured:
                    time_since_last_check = current_time - last_release_check_time
                    run_now = False
                    if release_interval_hours > 0 and time_since_last_check >= timedelta(hours=release_interval_hours):
                        run_now = True
                    
                    if mac_list_is_configured:
                        run_now = True

                    if run_now:
                        run_auto_release_cycle(config)
                        last_release_check_time = current_time
                    else:
                         print("[*] Aún no es tiempo para el ciclo de liberación por inactividad.")
                else:
                    print("[*] La liberación automática está desactivada (umbral <= 0 y lista de MACs vacía).")

                print(f"--- Ciclos finalizados. Esperando {SCAN_INTERVAL_SECONDS} segundos... ---\n")
                time.sleep(SCAN_INTERVAL_SECONDS)

            except KeyboardInterrupt:
                print("\n[*] Deteniendo el worker...")
                log_event("El worker de escaneo y automatización ha sido detenido.")
                db.session.commit()
                break
            except Exception as e:
                error_msg = f"Error crítico en el bucle principal del worker: {e}"
                log_event(error_msg, level='ERROR')
                db.session.commit()
                time.sleep(SCAN_INTERVAL_SECONDS * 2)
