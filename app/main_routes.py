from flask import Blueprint, render_template, request, flash, redirect, url_for
from flask_login import login_user, logout_user, current_user, login_required
from app.models import User
from app import db

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
@login_required # <-- PROTEGER LA PÁGINA PRINCIPAL
def index():
    """Sirve la página principal de la aplicación (index.html)."""
    return render_template('index.html')

# --- NUEVAS RUTAS DE AUTENTICACIÓN ---
@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    # Si el usuario ya está autenticado, lo redirigimos a la página principal
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        
        if user is None or not user.check_password(password):
            flash('Usuario o contraseña inválidos.', 'danger')
            return redirect(url_for('main.login'))
        
        # Si el usuario y la contraseña son correctos, iniciamos sesión
        login_user(user)
        # Redirigimos a la página que el usuario intentaba acceder, o al index si no había ninguna.
        next_page = request.args.get('next')
        return redirect(next_page or url_for('main.index'))

    return render_template('login.html')

@main_bp.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Has cerrado sesión correctamente.', 'success')
    return redirect(url_for('main.login'))
