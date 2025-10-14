# scanner_worker.py

import time
import threading
from datetime import datetime, timedelta, UTC, date as date_obj
from sqlalchemy import or_
from scapy.all import sniff, DHCP, BOOTP

from app import create_app, db
from app.models import ApplicationConfig, Device, HistoricalStat
from app.scanner.core import discover_hosts, sync_devices_db, log_event, perform_dhcp_release, is_host_alive

# --- CONFIGURACIÓN DEL WORKER ---
INACTIVE_THRESHOLD_MINUTES = 5 # Umbral para considerar un dispositivo inactivo

# --- [!] MODO DE DIAGNÓSTICO DEL SNIFFER [!] ---
# Ponlo en True para imprimir todos los paquetes DHCP que el sniffer capture.
# Útil para depurar por qué no se detectan dispositivos.
# Una vez que confirmes que funciona, puedes volver a ponerlo en False.
ENABLE_SNIFFER_DIAGNOSTICS = True
# ------------------------------------------------

# Diccionario en memoria para mantener las estadísticas del día actual
daily_stats = {}

# Creamos una instancia de la app separada para que el hilo del sniffer tenga su propio contexto
app_for_sniffer = create_app()

def packet_handler(packet):
    """Callback para procesar paquetes DHCP capturados por Scapy."""
    if not packet.haslayer(DHCP):
        return

    dhcp_options = {opt[0]: opt[1] for opt in packet[DHCP].options if isinstance(opt, tuple)}
    message_type = dhcp_options.get('message-type')

    # --- LÓGICA DE EXTRACCIÓN DE IP MEJORADA PARA DIAGNÓSTICO ---
    ip_diag = 'N/A'
    if packet[BOOTP].yiaddr != '0.0.0.0':
        ip_diag = packet[BOOTP].yiaddr
    elif packet[BOOTP].ciaddr != '0.0.0.0':
        ip_diag = packet[BOOTP].ciaddr
    elif 'requested_addr' in dhcp_options:
        ip_diag = dhcp_options['requested_addr']

    # --- INICIO BLOQUE DE DIAGNÓSTICO ---
    if ENABLE_SNIFFER_DIAGNOSTICS:
        try:
            client_mac_diag = packet[BOOTP].chaddr[:6].hex(':').upper()
            type_map = {1: 'DISCOVER', 2: 'OFFER', 3: 'REQUEST', 4: 'DECLINE', 5: 'ACK', 6: 'NAK', 7: 'RELEASE'}
            message_type_str = type_map.get(message_type, f'Unknown ({message_type})')
            
            print(f"--- [Sniffer Diag] Paquete DHCP Capturado: Tipo={message_type_str}, MAC={client_mac_diag}, IP={ip_diag} ---")
        except Exception as e:
            print(f"--- [Sniffer Diag] Error al analizar paquete para diagnóstico: {e} ---")
    # --- FIN BLOQUE DE DIAGNÓSTICO ---

    # Solo nos interesan OFFER(2), REQUEST(3) y ACK(5)
    if message_type not in [2, 3, 5]: 
        return

    client_mac = packet[BOOTP].chaddr[:6].hex(':').upper()
    
    # --- LÓGICA DE EXTRACCIÓN DE IP CORREGIDA Y ROBUSTA ---
    client_ip = '0.0.0.0'
    if packet[BOOTP].yiaddr != '0.0.0.0':         # Prioridad 1: IP asignada en OFFER/ACK
        client_ip = packet[BOOTP].yiaddr
    elif packet[BOOTP].ciaddr != '0.0.0.0':       # Prioridad 2: IP del cliente en RENEW
        client_ip = packet[BOOTP].ciaddr
    elif 'requested_addr' in dhcp_options:        # Prioridad 3: IP solicitada en REQUEST inicial
        client_ip = dhcp_options['requested_addr']

    lease_time_seconds = dhcp_options.get('lease_time')

    if not client_mac or client_ip == '0.0.0.0':
        return

    with app_for_sniffer.app_context():
        try:
            device = Device.query.filter_by(mac_address=client_mac).first()
            current_time = datetime.now(UTC)
            
            if device:
                device.ip_address = client_ip
                device.last_seen = current_time
                device.status = 'active'
                device.last_seen_by = 'sniffer'
                if lease_time_seconds:
                    device.lease_start_time = current_time
                    device.lease_duration_seconds = lease_time_seconds
            else:
                device = Device(
                    mac_address=client_mac,
                    ip_address=client_ip,
                    vendor='Desconocido (Sniffer)',
                    first_seen=current_time,
                    last_seen=current_time,
                    status='active',
                    last_seen_by='sniffer'
                )
                if lease_time_seconds:
                    device.lease_start_time = current_time
                    device.lease_duration_seconds = lease_time_seconds
                db.session.add(device)
                log_event(f"Nuevo dispositivo descubierto (Sniffer): IP {client_ip}, MAC {client_mac}")

            db.session.commit()
        except Exception as e:
            print(f"[!!!] Error en packet_handler: {e}")
            db.session.rollback()

def run_sniffer(interface, stop_event):
    """Inicia el sniffer de Scapy en un hilo."""
    print(f"[*] Iniciando sniffer DHCP en la interfaz '{interface}'...")
    try:
        sniff(
            filter="udp and (port 67 or 68)", 
            prn=packet_handler, 
            iface=interface, 
            store=0,
            stop_filter=lambda p: stop_event.is_set()
        )
        print(f"[*] Sniffer en la interfaz '{interface}' detenido.")
    except Exception as e:
        print(f"[!!!] Error crítico al iniciar el sniffer en '{interface}': {e}")
        with app_for_sniffer.app_context():
            log_event(f"Error crítico del sniffer en la interfaz '{interface}': {e}. El sniffer se ha detenido.", "ERROR")
            db.session.commit()

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
        
        stat_entry.releases_inactivity = (stat_entry.releases_inactivity or 0) + daily_stats.get("releases_inactivity", 0)
        stat_entry.releases_mac_list = (stat_entry.releases_mac_list or 0) + daily_stats.get("releases_mac_list", 0)
        
        stat_entry.active_devices_peak = max(
            stat_entry.active_devices_peak or 0,
            daily_stats.get("active_devices_peak", 0)
        )

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

# --- [NUEVA FUNCIÓN] ---
def update_daily_active_peak():
    """
    Calcula el número de dispositivos activos y actualiza el pico del día.
    Esta función es independiente del método de descubrimiento.
    """
    global daily_stats
    try:
        threshold = datetime.now(UTC) - timedelta(minutes=INACTIVE_THRESHOLD_MINUTES)
        current_active_count = Device.query.filter(Device.last_seen > threshold).count()

        if current_active_count > daily_stats.get("active_devices_peak", 0):
            old_peak = daily_stats.get("active_devices_peak", 0)
            daily_stats["active_devices_peak"] = current_active_count
            print(f"[*] Nuevo pico de dispositivos activos hoy: {current_active_count} (anterior: {old_peak})")

    except Exception as e:
        print(f"[!!!] ERROR al actualizar el pico de dispositivos activos: {e}")


def run_scan_cycle(app_config):
    """Realiza un ciclo de escaneo Nmap."""
    print("--- Iniciando ciclo de escaneo Nmap ---")
    
    if not app_config.scan_subnet:
        print("[!] La subred de escaneo no está configurada. Saltando ciclo de Nmap.")
        return

    discovered_hosts = discover_hosts(app_config.scan_subnet)
    
    # La lógica del pico de activos se ha movido a update_daily_active_peak()
    # para que funcione con todos los modos de descubrimiento.
    if discovered_hosts is not None:
        sync_devices_db(discovered_hosts)

def run_auto_release_cycle(app_config):
    """Ejecuta la lógica de liberación automática."""
    global daily_stats
    print("--- [!] Iniciando ciclo de liberación automática ---")
    
    if app_config.dry_run_enabled:
        print("--- [!] MODO DRY RUN ACTIVADO: Solo se simularán las acciones. ---")
    
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
    """Procesa una única liberación, aplicando la política de liberación."""
    global daily_stats
    
    if app_config.release_policy == 'ping_before_release':
        print(f"[*] Comprobando con ping a {device.ip_address} antes de liberar...")
        if is_host_alive(device.ip_address):
            log_msg = f"OMITIDA liberación para {device.ip_address} (MAC: {device.mac_address}) porque responde al ping."
            log_event(log_msg, 'INFO')
            db.session.commit()
            return

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
        
        if release_type == 'inactivity':
            daily_stats["releases_inactivity"] += 1
        elif release_type == 'mac_list':
            daily_stats["releases_mac_list"] += 1
            
        db.session.commit()
    elif not success:
        log_event(f"Falló el intento de liberación automática para la IP {device.ip_address}", 'ERROR')
        db.session.commit()
    time.sleep(1)

def check_for_config_changes(new_config, old_config):
    """Compara dos diccionarios de configuración y muestra los cambios en consola."""
    if old_config is None:
        return # Es el primer ciclo, no hay nada que comparar.
    
    changes = []
    # Lista de claves a comparar y sus nombres "amigables"
    keys_to_check = {
        'discovery_method': 'Método de descubrimiento',
        'release_policy': 'Política de liberación',
        'scan_subnet': 'Subred de escaneo',
        'network_interface': 'Interfaz de red',
        'dhcp_server_ip': 'IP del servidor DHCP',
        'scan_interval_seconds': 'Intervalo de escaneo',
        'auto_release_threshold_hours': 'Umbral de liberación',
        'dry_run_enabled': 'Modo simulación (Dry Run)'
    }
    
    for key, name in keys_to_check.items():
        if new_config.get(key) != old_config.get(key):
            changes.append(f"  - {name}: '{old_config.get(key)}' -> '{new_config.get(key)}'")
            
    if new_config.get('mac_auto_release_list') != old_config.get('mac_auto_release_list'):
        changes.append("  - Lista de MACs para liberación automática ha sido modificada.")

    if changes:
        print("\n--- [!] CAMBIO DE CONFIGURACIÓN DETECTADO [!] ---")
        for change in changes:
            print(change)
        print("--------------------------------------------------\n")

if __name__ == '__main__':
    main_app = create_app()
    with main_app.app_context():
        log_event("Iniciando el worker de escaneo y automatización.")
        db.session.commit()

        reset_daily_stats()

        sniffer_thread = None
        sniffer_stop_event = threading.Event()
        
        last_config = None # Almacena la configuración del ciclo anterior
        
        while True:
            try:
                if date_obj.today() != daily_stats["date"]:
                    commit_daily_stats()
                    reset_daily_stats()

                config = ApplicationConfig.get_settings()
                current_config_dict = config.to_dict()
                
                check_for_config_changes(current_config_dict, last_config)
                
                sniffer_should_run = config.discovery_method in ['sniffer', 'both']
                
                # Reiniciar el sniffer si cambia la interfaz o si el hilo muere
                interface_changed = last_config and last_config['network_interface'] != config.network_interface
                sniffer_dead = sniffer_thread and not sniffer_thread.is_alive()

                if sniffer_should_run and (not sniffer_thread or sniffer_dead or interface_changed):
                    if sniffer_thread:
                        print("[*] La configuración de red ha cambiado o el hilo del sniffer murió. Reiniciando...")
                        sniffer_stop_event.set()
                        sniffer_thread.join(timeout=2)
                    
                    sniffer_stop_event.clear()
                    sniffer_thread = threading.Thread(
                        target=run_sniffer, 
                        args=(config.network_interface, sniffer_stop_event), 
                        daemon=True
                    )
                    sniffer_thread.start()
                
                elif not sniffer_should_run and sniffer_thread and sniffer_thread.is_alive():
                    print("[*] El método de descubrimiento ha cambiado. Deteniendo el hilo del sniffer...")
                    sniffer_stop_event.set()
                    sniffer_thread.join(timeout=2)
                    sniffer_thread = None

                last_config = current_config_dict

                update_inactive_devices_status()
                
                # --- [NUEVA LLAMADA] ---
                # Ahora actualizamos el pico de activos en cada ciclo, sin importar el modo.
                update_daily_active_peak()

                if config.discovery_method in ['nmap', 'both']:
                    run_scan_cycle(config)
                
                run_auto_release_cycle(config)

                print(f"--- Ciclo finalizado. Esperando {config.scan_interval_seconds} segundos... ---\n")
                
                # Esperar el tiempo configurado
                wait_interval = config.scan_interval_seconds
                time.sleep(wait_interval)
                
                # --- [CORRECCIÓN] ---
                # Cierra la sesión de la base de datos para asegurar que la configuración
                # se recargue desde el archivo .db en el siguiente ciclo.
                db.session.remove()

            except KeyboardInterrupt:
                print("\n[*] Deteniendo el worker... Guardando estadísticas finales.")
                if sniffer_thread:
                    sniffer_stop_event.set()
                    sniffer_thread.join(timeout=2)
                commit_daily_stats()
                log_event("El worker de escaneo y automatización ha sido detenido.")
                db.session.commit()
                break
            except Exception as e:
                error_msg = f"Error crítico en el bucle principal del worker: {e}"
                print(f"[!!!] {error_msg}")
                try:
                    # Intenta registrar el error en la base de datos, pero podría fallar si es un error de DB
                    log_event(error_msg, level='ERROR')
                    db.session.commit()
                except:
                    db.session.rollback() # Si falla el log, deshacer para no dejar la sesión en mal estado.
                
                try:
                    # Intenta leer el intervalo de espera, con un valor por defecto si falla
                    wait_interval = ApplicationConfig.get_settings().scan_interval_seconds
                except:
                    wait_interval = 60
                
                time.sleep(wait_interval * 2) # Espera un tiempo prudencial antes de reintentar
                db.session.remove() # Asegura que la sesión se reinicie incluso después de un error grave
