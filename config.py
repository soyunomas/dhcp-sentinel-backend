import os

# Obtiene la ruta absoluta del directorio del proyecto
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    """Clase de configuración base para la aplicación."""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'una-clave-secreta-muy-dificil-de-adivinar'
    
    # Configuración de la base de datos SQLite
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'app.db')
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
