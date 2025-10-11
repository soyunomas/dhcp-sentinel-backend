// Variable global para almacenar el estado de la aplicación
const appState = {
    sortBy: 'last_seen',
    order: 'desc',
    searchTerm: '',
    currentPage: 1,
    perPage: 50,
    autoRefreshInterval: null,
    autoRefreshEnabled: true
};

// Instancia del modal de confirmación
let confirmationModal = null;
let confirmActionCallback = null;

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    // Configuración inicial de Day.js
    dayjs.extend(dayjs_plugin_relativeTime);
    dayjs.extend(dayjs_plugin_localizedFormat);
    dayjs.extend(dayjs_plugin_utc); // <-- Habilitar el plugin UTC
    dayjs.locale('es');

    // Inicializar el modal de Bootstrap
    confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));

    // Navegación
    document.getElementById('nav-dashboard').addEventListener('click', () => showView('dashboard'));
    document.getElementById('nav-config').addEventListener('click', () => showView('config'));
    document.getElementById('nav-logs').addEventListener('click', () => showView('logs'));

    // Controles del Dashboard
    document.getElementById('search-input').addEventListener('input', handleSearch);
    document.getElementById('per-page-select').addEventListener('change', handlePerPageChange);
    document.querySelectorAll('.sortable').forEach(header => header.addEventListener('click', handleSort));

    // Formulario de Configuración
    document.getElementById('config-form').addEventListener('submit', handleSaveConfig);
    document.getElementById('clear-database-btn').addEventListener('click', handleClearDatabase);

    // Toggle de auto-refresco
    const autoRefreshSwitch = document.getElementById('auto-refresh-switch');
    autoRefreshSwitch.addEventListener('change', (e) => {
        appState.autoRefreshEnabled = e.target.checked;
        toggleAutoRefresh();
    });

    // Carga inicial
    loadInitialData();
    toggleAutoRefresh();
});

// --- LÓGICA DE NAVEGACIÓN Y VISTAS ---
function showView(viewId) {
    // Ocultar todas las vistas
    document.getElementById('dashboard-view').classList.add('d-none');
    document.getElementById('config-view').classList.add('d-none');
    document.getElementById('logs-view').classList.add('d-none');

    // Quitar clase 'active' de todos los nav-links
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => link.classList.remove('active'));

    // Mostrar la vista seleccionada y marcar el link como activo
    document.getElementById(`${viewId}-view`).classList.remove('d-none');
    document.getElementById(`nav-${viewId}`).classList.add('active');

    // Cargar datos específicos de la vista
    switch (viewId) {
        case 'dashboard':
            fetchDevices();
            fetchStats();
            break;
        case 'config':
            fetchConfig();
            break;
        case 'logs':
            fetchLogs();
            break;
    }
}

function loadInitialData() {
    showView('dashboard');
    fetchConfig(true); // Cargar configuración para mostrar el banner de Dry Run
}

// --- MANEJO DE ESTADO Y CONTROLES ---
function handleSearch(event) {
    appState.searchTerm = event.target.value;
    appState.currentPage = 1; // Resetear a la primera página con cada nueva búsqueda
    fetchDevices();
}

function handlePerPageChange(event) {
    appState.perPage = event.target.value;
    appState.currentPage = 1;
    fetchDevices();
}

function handleSort(event) {
    const newSortBy = event.currentTarget.dataset.sort;
    if (appState.sortBy === newSortBy) {
        appState.order = appState.order === 'asc' ? 'desc' : 'asc';
    } else {
        appState.sortBy = newSortBy;
        appState.order = 'desc';
    }
    appState.currentPage = 1;
    fetchDevices();
}

function handleSaveConfig(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const configData = Object.fromEntries(formData.entries());
    
    // Asegurarnos de que los valores numéricos y booleanos se envíen correctamente
    configData.auto_release_threshold_hours = parseInt(configData.auto_release_threshold_hours, 10);
    configData.dry_run_enabled = formData.has('dry_run_enabled');

    updateConfig(configData);
}

function handleClearDatabase() {
    showConfirmationModal(
        'Limpiar Base de Datos',
        '¿Estás seguro de que quieres eliminar <strong>todos los dispositivos y logs</strong>? Esta acción es irreversible.',
        () => {
            showSpinner();
            fetch('/api/database/clear', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    showNotification('Éxito', 'La base de datos ha sido limpiada.', 'success');
                    fetchDevices(); // Recargar datos para mostrar tablas vacías
                    fetchStats();
                    fetchLogs();
                })
                .catch(error => showNotification('Error', `No se pudo limpiar la base de datos: ${error.message}`, 'danger'))
                .finally(hideSpinner);
        }
    );
}


function toggleAutoRefresh() {
    if (appState.autoRefreshEnabled && !appState.autoRefreshInterval) {
        appState.autoRefreshInterval = setInterval(() => {
            const currentView = document.querySelector('.nav-link.active').id.split('-')[1];
            if (currentView === 'dashboard') {
                fetchDevices();
                fetchStats();
            } else if (currentView === 'logs') {
                fetchLogs();
            }
        }, 10000); // 10 segundos
    } else if (!appState.autoRefreshEnabled && appState.autoRefreshInterval) {
        clearInterval(appState.autoRefreshInterval);
        appState.autoRefreshInterval = null;
    }
}

// --- FUNCIONES DE FETCH (LLAMADAS A LA API) ---
function fetchDevices() {
    const url = new URL('/api/devices', window.location.origin);
    url.searchParams.append('page', appState.currentPage);
    url.searchParams.append('per_page', appState.perPage);
    url.searchParams.append('sort_by', appState.sortBy);
    url.searchParams.append('order', appState.order);
    if (appState.searchTerm) {
        url.searchParams.append('search', appState.searchTerm);
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            renderDevices(data.items);
            renderPagination(data.pagination);
            updateSortIndicators();
        })
        .catch(error => console.error('Error al cargar dispositivos:', error));
}

function fetchStats() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(stats => {
            document.getElementById('stats-total-devices').textContent = stats.total_devices || 0;
            document.getElementById('stats-active-devices').textContent = stats.active_devices || 0;
            document.getElementById('stats-released-ips').textContent = stats.released_ips || 0;
        })
        .catch(error => console.error('Error al cargar estadísticas:', error));
}

function fetchConfig(updateBanner = false) {
    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            document.getElementById('scan_subnet').value = config.scan_subnet || '';
            document.getElementById('dhcp_server_ip').value = config.dhcp_server_ip || '';
            document.getElementById('network_interface').value = config.network_interface || '';
            document.getElementById('auto_release_threshold_hours').value = config.auto_release_threshold_hours || 0;
            document.getElementById('mac_auto_release_list').value = config.mac_auto_release_list || '';
            document.getElementById('dry_run_enabled').checked = config.dry_run_enabled;
            if (updateBanner) {
                renderDryRunBanner(config.dry_run_enabled);
            }
        })
        .catch(error => console.error('Error al cargar la configuración:', error));
}

function updateConfig(configData) {
    showSpinner();
    fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        showNotification('Éxito', 'La configuración ha sido guardada.', 'success');
        renderDryRunBanner(data.config.dry_run_enabled);
    })
    .catch(error => showNotification('Error', `No se pudo guardar la configuración: ${error.message}`, 'danger'))
    .finally(hideSpinner);
}

function fetchLogs() {
    fetch('/api/logs?limit=200')
        .then(response => response.json())
        .then(logs => renderLogs(logs))
        .catch(error => console.error('Error al cargar los logs:', error));
}

function performDeviceAction(url, method, body = null) {
    showSpinner();
    const options = {
        method: method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    fetch(url, options)
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            showNotification('Éxito', data.message, 'success');
            fetchDevices(); // Recargar la lista de dispositivos
            fetchStats();   // Actualizar estadísticas
        })
        .catch(error => showNotification('Error', `La operación falló: ${error.message}`, 'danger'))
        .finally(hideSpinner);
}


// --- FUNCIONES DE RENDERIZADO ---
function renderDevices(devices) {
    const tableBody = document.getElementById('devices-table-body');
    if (!devices || devices.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No se encontraron dispositivos.</td></tr>';
        return;
    }

    tableBody.innerHTML = devices.map(device => {
        const statusBadge = device.status === 'active' ? 'bg-success' : 'bg-secondary';
        const excludedBadge = device.is_excluded ? '<span class="badge bg-warning">Sí</span>' : '<span class="badge bg-light text-dark">No</span>';
        
        // --- BLOQUE CORREGIDO CON dayjs.utc() ---
        const lastSeenUTC = dayjs.utc(device.last_seen);
        const lastSeen = device.last_seen 
            ? `<span title="En tu hora local: ${lastSeenUTC.local().format('YYYY-MM-DD HH:mm:ss')}">${lastSeenUTC.fromNow()}</span>` 
            : 'Nunca';
        // --- FIN DEL BLOQUE CORREGIDO ---

        const excludeButton = device.is_excluded
            ? `<button class="btn btn-sm btn-outline-secondary" onclick="toggleExclusion(${device.id}, false)" title="Permitir que este dispositivo sea gestionado por las reglas automáticas.">Incluir</button>`
            : `<button class="btn btn-sm btn-secondary" onclick="toggleExclusion(${device.id}, true)" title="Proteger este dispositivo de la liberación automática.">Excluir</button>`;

        return `
            <tr>
                <td>${device.ip_address}</td>
                <td>${device.mac_address}</td>
                <td>${device.vendor || 'Desconocido'}</td>
                <td>${lastSeen}</td>
                <td><span class="badge ${statusBadge}">${device.status}</span></td>
                <td>${excludedBadge}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="releaseIp(${device.id})">Liberar</button>
                    ${excludeButton}
                </td>
            </tr>
        `;
    }).join('');
}


function renderPagination(pagination) {
    const controls = document.getElementById('pagination-controls');
    if (!pagination || pagination.total_pages <= 1) {
        controls.innerHTML = '';
        return;
    }

    let html = `<nav aria-label="Navegación de dispositivos"><ul class="pagination pagination-sm mb-0">`;

    // Botón de 'Anterior'
    html += `<li class="page-item ${pagination.has_prev ? '' : 'disabled'}">
        <a class="page-link" href="#" onclick="changePage(${pagination.page - 1})">Anterior</a>
    </li>`;

    // Páginas (lógica para mostrar un rango manejable)
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.total_pages, pagination.page + 2);
    
    if (startPage > 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<li class="page-item ${i === pagination.page ? 'active' : ''}">
            <a class="page-link" href="#" onclick="changePage(${i})">${i}</a>
        </li>`;
    }

    if (endPage < pagination.total_pages) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;

    // Botón de 'Siguiente'
    html += `<li class="page-item ${pagination.has_next ? '' : 'disabled'}">
        <a class="page-link" href="#" onclick="changePage(${pagination.page + 1})">Siguiente</a>
    </li>`;

    html += `</ul></nav>`;
    controls.innerHTML = html;
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable span').forEach(span => span.textContent = '');
    const activeHeader = document.querySelector(`.sortable[data-sort="${appState.sortBy}"] span`);
    if (activeHeader) {
        activeHeader.textContent = appState.order === 'asc' ? ' ▲' : ' ▼';
    }
}

function renderLogs(logs) {
    const list = document.getElementById('logs-list');
    if (!logs || logs.length === 0) {
        list.innerHTML = '<div class="list-group-item">No hay registros de actividad.</div>';
        return;
    }

    const levelMap = {
        'INFO': { class: 'list-group-item-secondary', icon: 'ℹ️' },
        'WARNING': { class: 'list-group-item-warning', icon: '⚠️' },
        'ERROR': { class: 'list-group-item-danger', icon: '❌' }
    };

    list.innerHTML = logs.map(log => {
        const config = levelMap[log.level] || levelMap['INFO'];
        const logTime = dayjs.utc(log.timestamp).local().format('YYYY-MM-DD HH:mm:ss');
        return `
            <div class="list-group-item d-flex justify-content-between align-items-start ${config.class}">
                <div class="ms-2 me-auto">
                    <div class="fw-bold">${config.icon} ${log.level}</div>
                    ${log.message}
                </div>
                <span class="badge bg-dark rounded-pill">${logTime}</span>
            </div>
        `;
    }).join('');
}

function renderDryRunBanner(isEnabled) {
    const banner = document.getElementById('dry-run-banner');
    if (isEnabled) {
        banner.innerHTML = `
            <div class="alert alert-warning" role="alert">
                <strong>Modo Simulación (Dry Run) está ACTIVO.</strong> Las acciones automáticas y manuales de liberación de IP serán registradas, pero no ejecutadas.
            </div>
        `;
    } else {
        banner.innerHTML = '';
    }
}


// --- ACCIONES DE DISPOSITIVO (invocadas desde los botones) ---
function changePage(newPage) {
    appState.currentPage = newPage;
    fetchDevices();
}

function releaseIp(deviceId) {
    performDeviceAction(`/api/devices/${deviceId}/release`, 'POST');
}

function toggleExclusion(deviceId, isExcluded) {
    performDeviceAction(`/api/devices/${deviceId}/exclude`, 'PUT', { is_excluded: isExcluded });
}


// --- UTILIDADES (Spinner, Notificaciones, Modal) ---
function showSpinner() {
    document.getElementById('spinner-overlay').classList.remove('d-none');
}

function hideSpinner() {
    document.getElementById('spinner-overlay').classList.add('d-none');
}

function showNotification(title, message, type = 'info') {
    const notificationArea = document.getElementById('notification-area');
    const toastId = `toast-${Date.now()}`;
    const toastHTML = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header">
                <strong class="me-auto text-${type}">${title}</strong>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;
    notificationArea.insertAdjacentHTML('beforeend', toastHTML);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
}

function showConfirmationModal(title, body, onConfirm) {
    document.getElementById('confirmationModalLabel').textContent = title;
    document.getElementById('confirmationModalBody').innerHTML = body;
    
    const confirmButton = document.getElementById('confirmActionButton');
    
    // Es importante remover el listener anterior para evitar que se acumulen
    confirmButton.replaceWith(confirmButton.cloneNode(true));
    document.getElementById('confirmActionButton').addEventListener('click', () => {
        onConfirm();
        confirmationModal.hide();
    });

    confirmationModal.show();
}
