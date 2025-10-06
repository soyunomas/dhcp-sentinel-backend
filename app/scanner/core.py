import nmap
import sys
from scapy.all import *
from datetime import datetime, UTC # <-- Importamos UTC

from app import db
from app.models import Device, ApplicationConfig, LogEntry

# Silenciar las advertencias de Scapy sobre IPv6
import logging
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)

def log_event(message, level='INFO'):
    """
    Función de ayuda para registrar eventos.
    Añade la entrada a la sesión, pero NO hace commit.
    """
    entry = LogEntry(message=message, level=level)
    db.session.add(entry)
    print(f"[{level}] {message}")

def discover_hosts(network_range):
    """
    Usa Nmap para descubrir hosts activos y sus detalles.
    """
    print(f"[*] Iniciando escaneo de red en {network_range}...")
    nm = nmap.PortScanner()
    hosts_list = []
    try:
        scan_args = '-sn -PR' 
        nm.scan(hosts=network_range, arguments=scan_args)
    except Exception as e:
        log_event(f"Error inesperado durante el escaneo de Nmap: {e}", 'ERROR')
        db.session.commit()
        return []

    for host_ip in nm.all_hosts():
        if 'mac' in nm[host_ip]['addresses']:
            mac_address = nm[host_ip]['addresses']['mac'].upper()
            vendor = nm[host_ip]['vendor'].get(mac_address, 'Desconocido')
            
            hosts_list.append({
                'ip': host_ip,
                'mac': mac_address,
                'vendor': vendor
            })
            
    print(f"[OK] Escaneo completado. Se encontraron {len(hosts_list)} hosts activos.")
    return hosts_list

def sync_devices_db(discovered_hosts):
    """
    Sincroniza la lista de hosts descubiertos con la base de datos de forma atómica
    y manejando duplicados en el escaneo.
    """
    if not discovered_hosts:
        print("[*] No se encontraron hosts para sincronizar.")
        return

    print("[*] Sincronizando dispositivos con la base de datos...")
    # --- LÍNEA ACTUALIZADA ---
    current_time = datetime.now(UTC)
    
    processed_macs_in_scan = {}
    for host in discovered_hosts:
        processed_macs_in_scan[host['mac']] = host

    all_db_devices_map = {device.mac_address: device for device in Device.query.all()}
    
    try:
        for mac, host in processed_macs_in_scan.items():
            ip = host['ip']
            vendor = host['vendor']
            
            device = all_db_devices_map.get(mac)
            
            if device:
                device.ip_address = ip
                device.last_seen = current_time
                if device.status != 'active':
                    device.status = 'active'
            else:
                new_device = Device(
                    ip_address=ip,
                    mac_address=mac,
                    vendor=vendor,
                    first_seen=current_time,
                    last_seen=current_time,
                    status='active'
                )
                db.session.add(new_device)
                log_event(f"Nuevo dispositivo descubierto: IP {ip}, MAC {mac}")
        
        db.session.commit()
        print("[OK] Sincronización de la base de datos completada.")

    except Exception as e:
        print(f"[!!!] ERROR durante la sincronización de la base de datos: {e}")
        db.session.rollback()
        log_event(f"Error de base de datos durante la sincronización: {e}", "ERROR")
        db.session.commit()


def perform_dhcp_release(target_ip, target_mac, dhcp_server_ip, interface):
    """
    Construye y envía un paquete DHCPRELEASE suplantado.
    """
    log_event(f"Intentando liberar la IP {target_ip} (MAC: {target_mac}) en la interfaz {interface}")
    
    try:
        hw = mac2str(target_mac)
        conf.L3socket = L3RawSocket
        conf.checkIPaddr = False

        packet = (Ether(src=target_mac, dst="ff:ff:ff:ff:ff:ff") /
                  IP(src=target_ip, dst=dhcp_server_ip) /
                  UDP(sport=68, dport=67) /
                  BOOTP(chaddr=hw, ciaddr=target_ip) /
                  DHCP(options=[("message-type", "release"), 
                                ("server_id", dhcp_server_ip), 
                                "end"]))
        
        sendp(packet, iface=interface, verbose=0)
        
        log_event(f"Paquete DHCPRELEASE enviado para IP {target_ip}", 'INFO')
        db.session.commit()
        return True
    except Exception as e:
        db.session.rollback() 
        error_msg = f"Error al enviar paquete DHCPRELEASE para {target_ip}: {e}. Interfaz: '{interface}'"
        log_event(error_msg, 'ERROR')
        db.session.commit()
        return False
