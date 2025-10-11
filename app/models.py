# app/models.py

import datetime
from app import db
from sqlalchemy.sql import func
from flask_login import UserMixin 
from app import bcrypt

# --- MODELO DE USUARIO ---
class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.username}>'

# --- MODELOS EXISTENTES ---

class Device(db.Model):
    __tablename__ = 'device'
    id = db.Column(db.Integer, primary_key=True)
    ip_address = db.Column(db.String(15), nullable=False)
    mac_address = db.Column(db.String(17), unique=True, nullable=False, index=True)
    vendor = db.Column(db.String(255), nullable=True)
    
    first_seen = db.Column(db.DateTime(timezone=True), nullable=False)
    last_seen = db.Column(db.DateTime(timezone=True), nullable=False)

    status = db.Column(db.String(50), default='active', nullable=False)
    is_excluded = db.Column(db.Boolean, default=False, nullable=False)

    def to_dict(self):
        # Función para formatear fechas de manera segura, asegurando el formato UTC con 'Z'
        def format_datetime_as_utc(dt):
            if not dt:
                return None
            # Asegura que la cadena ISO siempre termine con 'Z' (Zulu time / UTC)
            return dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

        return {
            'id': self.id,
            'ip_address': self.ip_address,
            'mac_address': self.mac_address,
            'vendor': self.vendor,
            'first_seen': format_datetime_as_utc(self.first_seen),
            'last_seen': format_datetime_as_utc(self.last_seen),
            'status': self.status,
            'is_excluded': self.is_excluded
        }

class ApplicationConfig(db.Model):
    __tablename__ = 'application_config'
    id = db.Column(db.Integer, primary_key=True)
    scan_subnet = db.Column(db.String(18), default='192.168.24.0/24')
    dhcp_server_ip = db.Column(db.String(15), default='192.168.24.1')
    network_interface = db.Column(db.String(50), default='enp0s3')
    auto_release_threshold_hours = db.Column(db.Integer, default=24)
    mac_auto_release_list = db.Column(db.Text, default='')
    dry_run_enabled = db.Column(db.Boolean, default=True, nullable=False)

    @staticmethod
    def get_settings():
        settings = db.session.get(ApplicationConfig, 1)
        if not settings:
            settings = ApplicationConfig(id=1)
            db.session.add(settings)
            db.session.commit()
        return settings

    def to_dict(self):
        return {
            'id': self.id,
            'scan_subnet': self.scan_subnet,
            'dhcp_server_ip': self.dhcp_server_ip,
            'network_interface': self.network_interface,
            'auto_release_threshold_hours': self.auto_release_threshold_hours,
            'mac_auto_release_list': self.mac_auto_release_list,
            'dry_run_enabled': self.dry_run_enabled
        }

class LogEntry(db.Model):
    __tablename__ = 'log_entry'
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime(timezone=True), server_default=func.now())
    level = db.Column(db.String(10), default='INFO')
    message = db.Column(db.String(500), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'level': self.level,
            'message': self.message
        }

# --- NUEVO MODELO PARA ESTADÍSTICAS HISTÓRICAS ---
class HistoricalStat(db.Model):
    __tablename__ = 'historical_stat'
    # La fecha es la clave primaria para asegurar una entrada por día.
    date = db.Column(db.Date, primary_key=True)
    
    # Contadores de liberaciones
    releases_manual = db.Column(db.Integer, default=0, nullable=False)
    releases_inactivity = db.Column(db.Integer, default=0, nullable=False)
    releases_mac_list = db.Column(db.Integer, default=0, nullable=False)

    # Snapshots de estado de la red
    total_devices_snapshot = db.Column(db.Integer, default=0, nullable=False)
    active_devices_peak = db.Column(db.Integer, default=0, nullable=False)

    def to_dict(self):
        return {
            'date': self.date.isoformat(),
            'releases_manual': self.releases_manual,
            'releases_inactivity': self.releases_inactivity,
            'releases_mac_list': self.releases_mac_list,
            'total_devices_snapshot': self.total_devices_snapshot,
            'active_devices_peak': self.active_devices_peak
        }
