# app/routes.py

from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from datetime import datetime, timedelta, UTC # <-- NUEVA IMPORTACIÓN
from app import db
from app.models import Device, ApplicationConfig, LogEntry
from app.scanner.core import perform_dhcp_release, log_event
from sqlalchemy import or_

bp = Blueprint('api', __name__, url_prefix='/api')

# --- PROTECCIÓN PARA TODA LA API ---
@bp.before_request
@login_required
def before_request():
    pass

@bp.route('/stats', methods=['GET'])
def get_stats():
    """Endpoint para obtener estadísticas generales de los dispositivos."""
    try:
        total_devices = Device.query.count()
        
        # --- LÍNEA CORREGIDA ---
        # Define "activo" como cualquier dispositivo visto en los últimos 5 minutos.
        # Esto funciona en todas las bases de datos.
        active_threshold = datetime.now(UTC) - timedelta(minutes=5)
        active_devices = Device.query.filter(Device.last_seen > active_threshold).count()
        # --- FIN DE LA CORRECCIÓN ---

        released_ips = Device.query.filter_by(status='released').count()
        
        stats = {
            'total_devices': total_devices,
            'active_devices': active_devices,
            'released_ips': released_ips
        }
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': f'No se pudieron calcular las estadísticas: {str(e)}'}), 500

@bp.route('/devices', methods=['GET'])
def get_devices():
    """Endpoint para obtener la lista de dispositivos, con soporte para búsqueda, ordenación y paginación."""
    # Parámetros de la solicitud
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    sort_by = request.args.get('sort_by', 'last_seen')
    order = request.args.get('order', 'desc')
    search_term = request.args.get('search', '')

    # Construcción de la consulta base
    query = Device.query

    # Filtro de búsqueda
    if search_term:
        search_pattern = f"%{search_term}%"
        query = query.filter(or_(Device.ip_address.ilike(search_pattern), Device.mac_address.ilike(search_pattern), Device.vendor.ilike(search_pattern)))

    # Lógica de ordenación
    allowed_sort_fields = ['ip_address', 'mac_address', 'vendor', 'first_seen', 'last_seen', 'status', 'is_excluded']
    if sort_by not in allowed_sort_fields:
        sort_by = 'last_seen'
    sort_column = getattr(Device, sort_by)
    if order == 'asc':
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Paginación
    paginated_devices = query.paginate(page=page, per_page=per_page, error_out=False)
    devices = paginated_devices.items

    # Formateo de la respuesta
    response = {
        'items': [device.to_dict() for device in devices],
        'pagination': {
            'page': paginated_devices.page,
            'per_page': paginated_devices.per_page,
            'total_pages': paginated_devices.pages,
            'total_items': paginated_devices.total,
            'has_next': paginated_devices.has_next,
            'has_prev': paginated_devices.has_prev
        }
    }
    return jsonify(response)


@bp.route('/config', methods=['GET'])
def get_config():
    """Endpoint para obtener la configuración actual de la aplicación."""
    settings = ApplicationConfig.get_settings()
    return jsonify(settings.to_dict())

@bp.route('/config', methods=['PUT'])
def update_config():
    """Endpoint para actualizar la configuración de la aplicación."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No input data provided'}), 400
    settings = ApplicationConfig.get_settings()
    if 'scan_subnet' in data: settings.scan_subnet = data['scan_subnet']
    if 'dhcp_server_ip' in data: settings.dhcp_server_ip = data['dhcp_server_ip']
    if 'network_interface' in data: settings.network_interface = data['network_interface']
    if 'auto_release_threshold_hours' in data: settings.auto_release_threshold_hours = data['auto_release_threshold_hours']
    if 'mac_auto_release_list' in data: settings.mac_auto_release_list = data['mac_auto_release_list']
    if 'dry_run_enabled' in data: settings.dry_run_enabled = data['dry_run_enabled']
    
    db.session.commit()
    return jsonify({'message': 'Configuración actualizada correctamente', 'config': settings.to_dict()})

@bp.route('/database/clear', methods=['POST'])
def clear_database():
    """
    Endpoint para eliminar todos los registros de Dispositivos y Logs.
    No toca la configuración ni los usuarios.
    """
    try:
        num_devices_deleted = db.session.query(Device).delete()
        num_logs_deleted = db.session.query(LogEntry).delete()
        
        log_event(f"El usuario '{current_user.username}' ha limpiado la base de datos. Se eliminaron {num_devices_deleted} dispositivos y {num_logs_deleted} logs.", "WARNING")
        
        db.session.commit()
        
        return jsonify({'message': 'La base de datos de dispositivos y logs ha sido limpiada correctamente.'})
    except Exception as e:
        db.session.rollback()
        log_event(f"Error al intentar limpiar la base de datos: {str(e)}", "ERROR")
        db.session.commit()
        return jsonify({'error': f'Ocurrió un error al limpiar la base de datos: {str(e)}'}), 500


@bp.route('/devices/<int:device_id>/release', methods=['POST'])
def release_device_ip(device_id):
    """Endpoint para liberar manualmente la concesión DHCP de un dispositivo."""
    device = db.session.get(Device, device_id)
    if not device: return jsonify({'error': 'Dispositivo no encontrado'}), 404
    
    config = ApplicationConfig.get_settings()
    
    success, was_dry_run = perform_dhcp_release(
        target_ip=device.ip_address, 
        target_mac=device.mac_address, 
        dhcp_server_ip=config.dhcp_server_ip, 
        interface=config.network_interface,
        dry_run_enabled=config.dry_run_enabled
    )
    
    if success:
        if not was_dry_run:
            device.status = 'released'
            db.session.commit()
            log_event(f"Liberada manualmente la IP {device.ip_address} (MAC: {device.mac_address})", 'INFO')
            message = f'Solicitud de liberación para {device.ip_address} enviada correctamente.'
        else:
            message = f'Simulación de liberación para {device.ip_address} completada.'
            
        return jsonify({'message': message, 'device': device.to_dict()})
    else:
        log_event(f"Falló el intento de liberación manual para la IP {device.ip_address}", 'ERROR')
        return jsonify({'error': 'Falló el envío del paquete DHCPRELEASE.'}), 500

@bp.route('/devices/<int:device_id>/exclude', methods=['PUT'])
def toggle_device_exclusion(device_id):
    """Endpoint para marcar/desmarcar un dispositivo como excluido."""
    device = db.session.get(Device, device_id)
    if not device: return jsonify({'error': 'Dispositivo no encontrado'}), 404
    data = request.get_json()
    if data is None or 'is_excluded' not in data or not isinstance(data['is_excluded'], bool):
        return jsonify({'error': 'Cuerpo de la solicitud inválido. Se esperaba {"is_excluded": boolean}'}), 400
    new_state = data['is_excluded']
    device.is_excluded = new_state
    db.session.commit()
    action = "marcado como excluido" if new_state else "desmarcado como excluido"
    log_event(f"Dispositivo {device.mac_address} ({device.ip_address}) {action}.", 'INFO')
    return jsonify({'message': f'Dispositivo {action} correctamente.', 'device': device.to_dict()})

@bp.route('/logs', methods=['GET'])
def get_logs():
    """Endpoint para obtener las entradas del registro de eventos."""
    limit = request.args.get('limit', 100, type=int)
    logs = LogEntry.query.order_by(LogEntry.timestamp.desc()).limit(limit).all()
    logs_list = [log.to_dict() for log in logs]
    return jsonify(logs_list)
