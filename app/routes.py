# app/routes.py

from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from datetime import datetime, timedelta, UTC, date as date_obj
from app import db
from app.models import Device, ApplicationConfig, LogEntry, HistoricalStat
from app.scanner.core import perform_dhcp_release, log_event
from sqlalchemy import or_
from sqlalchemy.exc import OperationalError 
import ipaddress

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
        
        active_threshold = datetime.now(UTC) - timedelta(minutes=5)
        active_devices = Device.query.filter(Device.last_seen > active_threshold).count()

        released_ips = Device.query.filter_by(status='released').count()
        
        stats = {
            'total_devices': total_devices,
            'active_devices': active_devices,
            'released_ips': released_ips
        }
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': f'No se pudieron calcular las estadísticas: {str(e)}'}), 500

@bp.route('/stats/historical', methods=['GET'])
def get_historical_stats():
    """
    Devuelve datos históricos agregados para los gráficos del frontend.
    """
    period_str = request.args.get('period', '7d')
    days = 7
    if period_str == '30d':
        days = 30
    elif period_str == '90d':
        days = 90

    start_date = date_obj.today() - timedelta(days=days - 1)
    
    try:
        stats = HistoricalStat.query.filter(HistoricalStat.date >= start_date).order_by(HistoricalStat.date.asc()).all()
    except OperationalError:
        error_msg = "La tabla de estadísticas no existe. Por favor, ejecuta 'flask db upgrade' para actualizar el esquema de la base de datos."
        log_event(error_msg, "ERROR")
        db.session.commit()
        return jsonify({'error': error_msg}), 500
    except Exception as e:
        log_event(f"Error al consultar estadísticas históricas: {str(e)}", "ERROR")
        db.session.commit()
        return jsonify({'error': f'Ocurrió un error en la base de datos: {str(e)}'}), 500

    labels = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(days)]
    
    data_map = {label: {
        'releases_inactivity': 0,
        'releases_mac_list': 0,
        'releases_manual': 0,
        'active_devices_peak': 0,
        'total_devices_snapshot': 0
    } for label in labels}

    for stat in stats:
        date_str = stat.date.isoformat()
        if date_str in data_map:
            data_map[date_str] = {
                'releases_inactivity': stat.releases_inactivity,
                'releases_mac_list': stat.releases_mac_list,
                'releases_manual': stat.releases_manual,
                'active_devices_peak': stat.active_devices_peak,
                'total_devices_snapshot': stat.total_devices_snapshot
            }

    response_data = {
        'labels': labels,
        'datasets': {
            'releases': [
                {'label': 'Liberadas por Inactividad', 'data': [data_map[d]['releases_inactivity'] for d in labels]},
                {'label': 'Liberadas por Lista MAC', 'data': [data_map[d]['releases_mac_list'] for d in labels]},
                {'label': 'Liberadas Manualmente', 'data': [data_map[d]['releases_manual'] for d in labels]}
            ],
            'activity': [
                {'label': 'Pico de Dispositivos Activos', 'data': [data_map[d]['active_devices_peak'] for d in labels]},
                {'label': 'Total Dispositivos Conocidos', 'data': [data_map[d]['total_devices_snapshot'] for d in labels]}
            ]
        }
    }
    
    return jsonify(response_data)

@bp.route('/devices', methods=['GET'])
def get_devices():
    """Endpoint para obtener la lista de dispositivos, con soporte para búsqueda, ordenación y paginación."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    sort_by = request.args.get('sort_by', 'last_seen')
    order = request.args.get('order', 'desc')
    search_term = request.args.get('search', '')

    query = Device.query

    if search_term:
        search_pattern = f"%{search_term}%"
        query = query.filter(or_(Device.ip_address.ilike(search_pattern), Device.mac_address.ilike(search_pattern), Device.vendor.ilike(search_pattern)))

    allowed_sort_fields = ['ip_address', 'mac_address', 'vendor', 'first_seen', 'last_seen', 'status', 'is_excluded']
    if sort_by not in allowed_sort_fields:
        sort_by = 'last_seen'
    sort_column = getattr(Device, sort_by)
    if order == 'asc':
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    paginated_devices = query.paginate(page=page, per_page=per_page, error_out=False)
    devices = paginated_devices.items

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
    settings = ApplicationConfig.get_settings()
    return jsonify(settings.to_dict())

@bp.route('/config', methods=['PUT'])
def update_config():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No input data provided'}), 400
    settings = ApplicationConfig.get_settings()

    if 'scan_subnet' in data:
        try:
            ipaddress.ip_network(data['scan_subnet'], strict=False)
            settings.scan_subnet = data['scan_subnet']
        except ValueError:
            return jsonify({'error': f"Formato de subred inválido: '{data['scan_subnet']}'. Use notación CIDR, ej: 192.168.1.0/24."}), 400

    if 'dhcp_server_ip' in data: settings.dhcp_server_ip = data['dhcp_server_ip']
    if 'network_interface' in data: settings.network_interface = data['network_interface']
    if 'auto_release_threshold_hours' in data: settings.auto_release_threshold_hours = data['auto_release_threshold_hours']
    if 'mac_auto_release_list' in data: settings.mac_auto_release_list = data['mac_auto_release_list']
    if 'dry_run_enabled' in data: settings.dry_run_enabled = data['dry_run_enabled']
    
    db.session.commit()
    return jsonify({'message': 'Configuración actualizada correctamente', 'config': settings.to_dict()})

@bp.route('/database/clear', methods=['POST'])
def clear_database():
    try:
        num_devices_deleted = db.session.query(Device).delete()
        num_logs_deleted = db.session.query(LogEntry).delete()
        num_stats_deleted = db.session.query(HistoricalStat).delete()
        
        log_event(f"El usuario '{current_user.username}' ha limpiado la base de datos. Se eliminaron {num_devices_deleted} dispositivos, {num_logs_deleted} logs y {num_stats_deleted} registros de estadísticas.", "WARNING")
        
        db.session.commit()
        
        return jsonify({'message': 'La base de datos de dispositivos, logs y estadísticas ha sido limpiada correctamente.'})
    except Exception as e:
        db.session.rollback()
        log_event(f"Error al intentar limpiar la base de datos: {str(e)}", "ERROR")
        db.session.commit()
        return jsonify({'error': f'Ocurrió un error al limpiar la base de datos: {str(e)}'}), 500


@bp.route('/devices/<int:device_id>/release', methods=['POST'])
def release_device_ip(device_id):
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
            log_event(f"Liberada manualmente la IP {device.ip_address} (MAC: {device.mac_address})", 'INFO')
            
            today = date_obj.today()
            stat_entry = db.session.get(HistoricalStat, today)
            if not stat_entry:
                stat_entry = HistoricalStat(
                    date=today,
                    releases_manual=0,
                    releases_inactivity=0,
                    releases_mac_list=0,
                    active_devices_peak=0,
                    total_devices_snapshot=0
                )
                db.session.add(stat_entry)
            
            stat_entry.releases_manual = (stat_entry.releases_manual or 0) + 1
            
            db.session.commit()
            message = f'Solicitud de liberación para {device.ip_address} enviada correctamente.'
        else:
            message = f'Simulación de liberación para {device.ip_address} completada.'
            
        return jsonify({'message': message, 'device': device.to_dict()})
    else:
        log_event(f"Falló el intento de liberación manual para la IP {device.ip_address}", 'ERROR')
        db.session.commit()
        return jsonify({'error': 'Falló el envío del paquete DHCPRELEASE.'}), 500

@bp.route('/devices/<int:device_id>/exclude', methods=['PUT'])
def toggle_device_exclusion(device_id):
    device = db.session.get(Device, device_id)
    if not device: return jsonify({'error': 'Dispositivo no encontrado'}), 404
    data = request.get_json()
    if data is None or 'is_excluded' not in data or not isinstance(data['is_excluded'], bool):
        return jsonify({'error': 'Cuerpo de la solicitud inválido. Se esperaba {"is_excluded": boolean}'}), 400
    
    new_state = data['is_excluded']
    device.is_excluded = new_state
    
    action = "marcado como excluido" if new_state else "desmarcado como excluido"
    log_event(f"Dispositivo {device.mac_address} ({device.ip_address}) {action}.", 'INFO')
    
    db.session.commit()
    
    return jsonify({'message': f'Dispositivo {action} correctamente.', 'device': device.to_dict()})

@bp.route('/logs', methods=['GET'])
def get_logs():
    limit = request.args.get('limit', 200, type=int)
    event_type = request.args.get('event_type', 'all') # <-- NUEVO PARÁMETRO

    query = LogEntry.query

    # --- INICIO DE MODIFICACIÓN: Lógica de filtrado ---
    if event_type == 'user_action':
        query = query.filter(or_(
            LogEntry.message.ilike('%Liberada manualmente%'),
            LogEntry.message.ilike('%marcado como excluido%'),
            LogEntry.message.ilike('%desmarcado como excluido%'),
            LogEntry.message.ilike('%ha limpiado la base de datos%')
        ))
    elif event_type == 'auto_release':
        query = query.filter(LogEntry.message.ilike('%liberada automáticamente%'))
    elif event_type == 'discovery':
        query = query.filter(LogEntry.message.ilike('%Nuevo dispositivo descubierto%'))
    elif event_type == 'system_error':
        query = query.filter(LogEntry.level == 'ERROR')
    elif event_type == 'dry_run':
        query = query.filter(LogEntry.message.ilike('%[DRY RUN]%'))
    # Si event_type es 'all' o cualquier otro valor, no se aplica ningún filtro de mensaje.
    # --- FIN DE MODIFICACIÓN ---

    logs = query.order_by(LogEntry.timestamp.desc()).limit(limit).all()
    logs_list = [log.to_dict() for log in logs]
    return jsonify(logs_list)
