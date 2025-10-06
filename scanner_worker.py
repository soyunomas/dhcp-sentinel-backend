import time
from datetime import datetime, timedelta, UTC
from sqlalchemy import or_

from app import create_app, db
from app.models import ApplicationConfig, Device
from app.scanner.core import discover_hosts, sync_devices_db, log_event, perform_dhcp_release

# --- CONFIGURACIÓN DEL WORKER ---
SCAN_INTERVAL_SECONDS = 60 
# --------------------------------

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
    Busca dispositivos para liberar automáticamente, ya sea por inactividad o por
    coincidir con la lista de MACs, y libera sus IPs si cumplen las condiciones.
    """
    print("--- [!] Iniciando ciclo de liberación automática programado ---")
    
    candidates_to_release = set()

    # --- Criterio 1: Liberación por inactividad ---
    threshold_hours = app_config.auto_release_threshold_hours
    # Esta comprobación ya está aquí, pero la mantenemos por si el usuario cambia el valor a 0 entre ciclos.
    if threshold_hours > 0:
        time_threshold = datetime.now(UTC) - timedelta(hours=threshold_hours)
        inactive_devices = Device.query.filter(
            Device.is_excluded == False,
            Device.status != 'released',
            Device.last_seen < time_threshold
        ).all()
        if inactive_devices:
            print(f"[*] Encontrados {len(inactive_devices)} dispositivo(s) por inactividad.")
            candidates_to_release.update(inactive_devices)
    else:
        # Esto no debería ocurrir si la lógica del bucle principal es correcta, pero es una salvaguarda.
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
        
        success = perform_dhcp_release(
            target_ip=device.ip_address,
            target_mac=device.mac_address,
            dhcp_server_ip=app_config.dhcp_server_ip,
            interface=app_config.network_interface
        )
        
        if success:
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

        # --- NUEVA LÓGICA DE TEMPORIZADOR ---
        # Inicializamos la última comprobación a un tiempo pasado para forzar
        # una ejecución en el primer ciclo si la configuración lo permite.
        last_release_check_time = datetime.now(UTC) - timedelta(days=1)

        while True:
            try:
                current_time = datetime.now(UTC)
                config = ApplicationConfig.get_settings()
                
                # 1. El ciclo de escaneo se ejecuta SIEMPRE (cada 60 segundos)
                run_scan_cycle(config)

                # 2. El ciclo de liberación automática SÓLO se ejecuta si ha pasado el tiempo configurado
                release_interval_hours = config.auto_release_threshold_hours
                if release_interval_hours > 0:
                    time_since_last_check = current_time - last_release_check_time
                    if time_since_last_check >= timedelta(hours=release_interval_hours):
                        run_auto_release_cycle(config)
                        # Actualizamos la marca de tiempo de la última ejecución
                        last_release_check_time = current_time
                    else:
                        print("[*] Aún no es tiempo para el ciclo de liberación automática.")
                else:
                    print("[*] La liberación automática está desactivada (umbral <= 0).")

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
