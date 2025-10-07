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
    
    # --- LÍNEAS CORREGIDAS: Eliminados todos los server_default ---
    first_seen = db.Column(db.DateTime(timezone=True), nullable=False)
    last_seen = db.Column(db.DateTime(timezone=True), nullable=False)
    # -----------------------------------------------------------

    status = db.Column(db.String(50), default='active', nullable=False)
    is_excluded = db.Column(db.Boolean, default=False, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'ip_address': self.ip_address,
            'mac_address': self.mac_address,
            'vendor': self.vendor,
            'first_seen': self.first_seen.isoformat() if self.first_seen else None,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
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
