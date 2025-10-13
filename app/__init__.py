from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from flask_wtf.csrf import CSRFProtect # <-- NUEVA IMPORTACIÓN
from config import Config

db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
bcrypt = Bcrypt()
csrf = CSRFProtect() # <-- NUEVA INSTANCIA

login_manager.login_view = 'main.login' 

def create_app(config_class=Config):
    """
    Fábrica de aplicaciones para crear y configurar la instancia de la app.
    """
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    bcrypt.init_app(app)
    csrf.init_app(app) # <-- INICIALIZAR CSRF PROTECT

    # Registrar el blueprint de las rutas principales (como '/')
    from app.main_routes import main_bp
    app.register_blueprint(main_bp)

    # Registrar el blueprint de la API (con prefijo '/api')
    from app.routes import bp as api_bp
    app.register_blueprint(api_bp)

    return app

from app import models

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(models.User, int(user_id))
