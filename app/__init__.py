from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager # <-- NUEVA IMPORTACIÓN
from flask_bcrypt import Bcrypt # <-- NUEVA IMPORTACIÓN
from config import Config

db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager() # <-- NUEVA INSTANCIA
bcrypt = Bcrypt() # <-- NUEVA INSTANCIA

# Le decimos a Flask-Login cuál es la vista para iniciar sesión.
# Si un usuario no autenticado intenta acceder a una ruta protegida, será redirigido aquí.
login_manager.login_view = 'main.login' 

def create_app(config_class=Config):
    """
    Fábrica de aplicaciones para crear y configurar la instancia de la app.
    """
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app) # <-- INICIALIZAR LOGIN MANAGER
    bcrypt.init_app(app) # <-- INICIALIZAR BCRYPT

    # Registrar el blueprint de las rutas principales (como '/')
    from app.main_routes import main_bp
    app.register_blueprint(main_bp)

    # Registrar el blueprint de la API (con prefijo '/api')
    from app.routes import bp as api_bp
    app.register_blueprint(api_bp)

    return app

from app import models

# Esta función es requerida por Flask-Login para cargar un usuario desde la sesión.
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(models.User, int(user_id))
