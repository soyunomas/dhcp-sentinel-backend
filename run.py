from app import create_app, db
from app.models import Device, ApplicationConfig, LogEntry, User

# Creamos la instancia de la aplicación
app = create_app()

@app.shell_context_processor
def make_shell_context():
    """
    Permite acceder a estos objetos directamente en el shell de Flask
    sin necesidad de importarlos manualmente.
    Ejemplo: `flask shell`
    """
    return {
        'db': db,
        'Device': Device,
        'ApplicationConfig': ApplicationConfig,
        'LogEntry': LogEntry,
        'User': User
    }

if __name__ == '__main__':
    # ADVERTENCIA: No uses app.run() en producción.
    # Usa un servidor WSGI como Gunicorn o Waitress.
    # El modo debug se ha desactivado por seguridad.
    app.run(host='0.0.0.0', port=5001, debug=False)
