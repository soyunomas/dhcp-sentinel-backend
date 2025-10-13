// app/static/js/main.js

// Estado global de la aplicación
const state = {
    currentPage: 1,
    perPage: 50,
    sortBy: 'last_seen',
    sortOrder: 'desc',
    searchTerm: '',
    autoRefresh: true,
    autoRefreshInterval: null,
    // [NUEVO] Referencia al objeto Offcanvas de Bootstrap
    deviceDetailOffcanvas: null, 
};

// --- INICIALIZACIÓN Y EVENT LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa Day.js con los plugins y el locale
    dayjs.extend(dayjs_plugin_relativeTime);
    dayjs.extend(dayjs_plugin_localizedFormat);
    dayjs.extend(dayjs_plugin_utc);
    dayjs.locale('es');
    
    // [NUEVO] Inicializa la instancia del Offcanvas
    state.deviceDetailOffcanvas = new bootstrap.Offcanvas(document.getElementById('deviceDetailOffcanvas'));

    // Navegación principal
    setupNavigation();

    // Carga de datos inicial
    fetchInitialData();

    // Controles de la tabla (búsqueda, paginación, etc.)
    setupTableControls();
    
    // Listener para el formulario de configuración
    document.getElementById('config-form').addEventListener('submit', handleConfigSave);
    
    // Listener para el botón de limpiar base de datos
    document.getElementById('clear-database-btn').addEventListener('click', () => {
        showConfirmationModal('¿Estás seguro de que quieres limpiar la base de datos de dispositivos, logs y estadísticas? Esta acción es irreversible.', clearDatabase);
    });

    // Controles de estadísticas y logs
    setupStatsControls();
    setupLogControls();

    // [NUEVO] Listener para clics en la tabla de dispositivos para mostrar detalles
    document.getElementById('devices-table-body').addEventListener('click', handleTableRowClick);
    
    // [NUEVO] Listeners para los botones de acción dentro del Offcanvas
    setupOffcanvasActionButtons();
});

function fetchInitialData() {
    showSpinner();
    Promise.all([
        fetchDashboardData(),
        fetchConfig()
    ]).catch(error => {
        console.error('Error en la carga inicial:', error);
        showToast('Error al cargar datos iniciales', 'danger');
    }).finally(() => {
        hideSpinner();
    });
}

function setupNavigation() {
    const navLinks = {
        'nav-dashboard': 'dashboard-view',
        'nav-stats': 'stats-view',
        'nav-config': 'config-view',
        'nav-logs': 'logs-view'
    };

    Object.keys(navLinks).forEach(navId => {
        document.getElementById(navId).addEventListener('click', (e) => {
            e.preventDefault();
            switchView(navLinks[navId]);
            document.querySelector('.nav-link.active').classList.remove('active');
            e.target.classList.add('active');
        });
    });
}

function setupTableControls() {
    // Ordenación de columnas
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const newSortBy = header.dataset.sort;
            if (state.sortBy === newSortBy) {
                state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortBy = newSortBy;
                state.sortOrder = 'desc';
            }
            fetchDevices();
        });
    });
    
    // Búsqueda
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchTerm = e.target.value;
            state.currentPage = 1;
            fetchDevices();
        }, 300);
    });

    // Selector de elementos por página
    document.getElementById('per-page-select').addEventListener('change', (e) => {
        state.perPage = e.target.value;
        state.currentPage = 1;
        fetchDevices();
    });
    
    // Auto-refresco
    const autoRefreshSwitch = document.getElementById('auto-refresh-switch');
    autoRefreshSwitch.addEventListener('change', () => {
        state.autoRefresh = autoRefreshSwitch.checked;
        if (state.autoRefresh) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });
    startAutoRefresh();
}

function setupStatsControls() {
    document.querySelectorAll('.period-selector').forEach(button => {
        button.addEventListener('click', (e) => {
            document.querySelector('.period-selector.active').classList.remove('active');
            e.target.classList.add('active');
            const period = e.target.dataset.period;
            fetchHistoricalStats(period);
        });
    });
}

function setupLogControls() {
    document.getElementById('log-filter-select').addEventListener('change', (e) => {
        fetchLogs(e.target.value);
    });
}

// --- LÓGICA DE NAVEGACIÓN ENTRE VISTAS ---

function switchView(viewId) {
    ['dashboard-view', 'stats-view', 'config-view', 'logs-view'].forEach(id => {
        document.getElementById(id).classList.add('d-none');
    });
    document.getElementById(viewId).classList.remove('d-none');

    if (viewId === 'stats-view') {
        fetchHistoricalStats();
    } else if (viewId === 'logs-view') {
        fetchLogs();
    }
}

// --- PETICIONES A LA API (FETCH) ---

async function apiFetch(url, options = {}) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken
    };

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    const response = await fetch(url, config);

    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('No autorizado');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}

function fetchDashboardData() {
    return Promise.all([fetchStats(), fetchDevices()]);
}

async function fetchStats() {
    try {
        const data = await apiFetch('/api/stats');
        document.getElementById('stats-total-devices').textContent = data.total_devices;
        document.getElementById('stats-active-devices').textContent = data.active_devices;
        document.getElementById('stats-released-ips').textContent = data.released_ips;
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

async function fetchDevices() {
    try {
        const url = `/api/devices?page=${state.currentPage}&per_page=${state.perPage}&sort_by=${state.sortBy}&order=${state.sortOrder}&search=${state.searchTerm}`;
        const data = await apiFetch(url);
        renderDevices(data.items);
        renderPagination(data.pagination);
        updateSortIndicator();
    } catch (error) {
        console.error('Error fetching devices:', error);
    }
}

async function fetchConfig() {
    try {
        const config = await apiFetch('/api/config');
        populateConfigForm(config);
        renderDryRunBanner(config.dry_run_enabled);
    } catch (error) {
        console.error('Error fetching config:', error);
    }
}

async function handleConfigSave(event) {
    event.preventDefault();
    showSpinner();
    
    const formData = new FormData(event.target);
    const data = {};
    formData.forEach((value, key) => {
        if (key === 'dry_run_enabled') {
            data[key] = value === 'on';
        } else if (['auto_release_threshold_hours', 'scan_interval_seconds'].includes(key)) {
            data[key] = parseInt(value, 10);
        } else {
            data[key] = value;
        }
    });
    // Asegurarse de que el checkbox no marcado se envíe como false
    if (!data.hasOwnProperty('dry_run_enabled')) {
        data.dry_run_enabled = false;
    }

    try {
        const response = await apiFetch('/api/config', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        showToast(response.message, 'success');
        renderDryRunBanner(response.config.dry_run_enabled);
    } catch (error) {
        showToast(error.message, 'danger');
    } finally {
        hideSpinner();
    }
}

async function clearDatabase() {
    showSpinner();
    try {
        const response = await apiFetch('/api/database/clear', { method: 'POST' });
        showToast(response.message, 'success');
        fetchDashboardData();
        fetchLogs();
    } catch (error) {
        showToast(error.message, 'danger');
    } finally {
        hideSpinner();
    }
}

// --- [NUEVO] LÓGICA PARA EL PANEL DE DETALLES ---

function handleTableRowClick(event) {
    // Evita que el clic en botones dentro de la fila active el panel
    if (event.target.tagName === 'BUTTON' || event.target.closest('button')) {
        return;
    }

    const row = event.target.closest('tr');
    if (row && row.dataset.deviceId) {
        const deviceId = row.dataset.deviceId;
        showDeviceDetails(deviceId);
    }
}

async function showDeviceDetails(deviceId) {
    const placeholder = document.getElementById('offcanvas-content-placeholder');
    const realContent = document.getElementById('offcanvas-content-real');

    placeholder.classList.remove('d-none');
    realContent.classList.add('d-none');
    state.deviceDetailOffcanvas.show();

    try {
        const device = await apiFetch(`/api/devices/${deviceId}`);
        
        // Rellenar datos
        document.getElementById('detail-ip-address').textContent = device.ip_address;
        document.getElementById('detail-mac-address').textContent = device.mac_address;
        document.getElementById('detail-vendor').textContent = device.vendor || 'Desconocido';
        
        // Estado
        const statusBadge = document.getElementById('detail-status');
        statusBadge.textContent = device.status;
        statusBadge.className = `badge ${getStatusClass(device.status)}`;
        
        // Timestamps
        document.getElementById('detail-last-seen').textContent = formatRelativeTime(device.last_seen);
        document.getElementById('detail-first-seen').textContent = formatFullDateTime(device.first_seen);
        
        // Descubierto por
        const seenByBadge = document.getElementById('detail-last-seen-by');
        seenByBadge.textContent = device.last_seen_by || 'N/A';
        seenByBadge.className = `badge ${device.last_seen_by === 'sniffer' ? 'bg-info' : 'bg-primary'}`;
        
        // Lease
        document.getElementById('detail-lease-start').textContent = formatFullDateTime(device.lease_start_time);
        document.getElementById('detail-lease-remaining').textContent = formatLeaseTime(device.lease_start_time, device.lease_duration_seconds);

        // Configurar botones de acción
        const excludeBtn = document.getElementById('detail-exclude-btn');
        if (device.is_excluded) {
            excludeBtn.textContent = 'Incluir en Automatización';
            excludeBtn.classList.remove('btn-warning');
            excludeBtn.classList.add('btn-success');
        } else {
            excludeBtn.textContent = 'Excluir de Automatización';
            excludeBtn.classList.remove('btn-success');
            excludeBtn.classList.add('btn-warning');
        }
        
        // Guardar el ID en los botones para las acciones
        document.getElementById('detail-ping-btn').dataset.deviceId = device.id;
        excludeBtn.dataset.deviceId = device.id;
        excludeBtn.dataset.isExcluded = device.is_excluded;
        document.getElementById('detail-release-btn').dataset.deviceId = device.id;
        
        // Mostrar contenido
        placeholder.classList.add('d-none');
        realContent.classList.remove('d-none');

    } catch (error) {
        showToast(`Error al cargar detalles: ${error.message}`, 'danger');
        state.deviceDetailOffcanvas.hide();
    }
}

function setupOffcanvasActionButtons() {
    document.getElementById('detail-ping-btn').addEventListener('click', async (e) => {
        const deviceId = e.target.dataset.deviceId;
        pingDevice(deviceId); // Reutilizamos la función de ping existente
    });

    document.getElementById('detail-exclude-btn').addEventListener('click', async (e) => {
        const deviceId = e.target.dataset.deviceId;
        const isExcluded = e.target.dataset.isExcluded === 'true';
        // Reutilizamos la función de exclusión existente
        await toggleExclusion(deviceId, !isExcluded);
        // Refrescar los detalles en el panel
        showDeviceDetails(deviceId);
    });

    document.getElementById('detail-release-btn').addEventListener('click', async (e) => {
        const deviceId = e.target.dataset.deviceId;
        // Reutilizamos la función de liberación existente
        releaseIp(deviceId);
        state.deviceDetailOffcanvas.hide();
    });
}

// --- RENDERIZADO DE LA UI ---

function renderDevices(devices) {
    const tableBody = document.getElementById('devices-table-body');
    tableBody.innerHTML = '';
    if (devices.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center">No se encontraron dispositivos.</td></tr>';
        return;
    }
    
    devices.forEach(device => {
        // [MODIFICADO] Añadido data-device-id a la fila y una clase para identificarla.
        const row = document.createElement('tr');
        row.dataset.deviceId = device.id;
        row.classList.add('device-row');
        row.style.cursor = 'pointer';

        row.innerHTML = `
            <td>${device.ip_address}</td>
            <td>${device.mac_address}</td>
            <td>${device.vendor || 'Desconocido'}</td>
            <td>${formatRelativeTime(device.last_seen)}</td>
            <td>${formatLeaseTime(device.lease_start_time, device.lease_duration_seconds)}</td>
            <td><span class="badge ${getStatusClass(device.status)}">${device.status}</span></td>
            <td><span class="badge ${device.last_seen_by === 'sniffer' ? 'bg-info' : 'bg-primary'}">${device.last_seen_by || 'N/A'}</span></td>
            <td>${device.is_excluded ? 'Sí' : 'No'}</td>
            <td class="actions-cell">
                <button class="btn btn-sm btn-primary" onclick="pingDevice(${device.id})">Ping</button>
                <button class="btn btn-sm btn-danger" onclick="releaseIp(${device.id})">Liberar</button>
                <button class="btn btn-sm btn-secondary" onclick="toggleExclusion(${device.id}, ${!device.is_excluded})">${device.is_excluded ? 'Incluir' : 'Excluir'}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function renderPagination(pagination) {
    const controls = document.getElementById('pagination-controls');
    controls.innerHTML = '';
    
    if (pagination.total_pages <= 1) return;
    
    let html = '<nav><ul class="pagination mb-0">';
    
    // Botón Anterior
    html += `<li class="page-item ${pagination.has_prev ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${pagination.page - 1}">Anterior</a>
    </li>`;

    // Lógica para mostrar las páginas
    const maxPagesToShow = 5;
    let startPage = Math.max(1, pagination.page - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(pagination.total_pages, startPage + maxPagesToShow - 1);
    
    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    if (startPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
        if (startPage > 2) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<li class="page-item ${i === pagination.page ? 'active' : ''}">
            <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>`;
    }

    if (endPage < pagination.total_pages) {
        if (endPage < pagination.total_pages - 1) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${pagination.total_pages}">${pagination.total_pages}</a></li>`;
    }
    
    // Botón Siguiente
    html += `<li class="page-item ${pagination.has_next ? '' : 'disabled'}">
        <a class="page-link" href="#" data-page="${pagination.page + 1}">Siguiente</a>
    </li>`;
    
    html += '</ul></nav>';
    controls.innerHTML = html;

    // Añadir event listeners a los nuevos botones
    controls.querySelectorAll('a.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.target.dataset.page;
            if (page) {
                state.currentPage = parseInt(page);
                fetchDevices();
            }
        });
    });
}

function populateConfigForm(config) {
    document.getElementById('dry_run_enabled').checked = config.dry_run_enabled;
    document.getElementById('discovery_method').value = config.discovery_method;
    document.getElementById('release_policy').value = config.release_policy;
    document.getElementById('scan_subnet').value = config.scan_subnet;
    document.getElementById('dhcp_server_ip').value = config.dhcp_server_ip;
    document.getElementById('network_interface').value = config.network_interface;
    document.getElementById('scan_interval_seconds').value = config.scan_interval_seconds;
    document.getElementById('auto_release_threshold_hours').value = config.auto_release_threshold_hours;
    document.getElementById('mac_auto_release_list').value = config.mac_auto_release_list;
}

// --- FUNCIONES DE ACCIÓN ---

async function pingDevice(deviceId) {
    showToast('Enviando ping...', 'info');
    try {
        const response = await apiFetch(`/api/devices/${deviceId}/ping`, { method: 'POST' });
        if (response.status === 'online') {
            showToast(`El dispositivo ${response.ip_address} está en línea.`, 'success');
        } else {
            showToast(`El dispositivo ${response.ip_address} no responde.`, 'warning');
        }
    } catch (error) {
        showToast(error.message, 'danger');
    }
}

function releaseIp(deviceId) {
    showConfirmationModal(
        '¿Estás seguro de que quieres liberar esta dirección IP? El dispositivo perderá la conectividad.',
        async () => {
            showSpinner();
            try {
                const response = await apiFetch(`/api/devices/${deviceId}/release`, { method: 'POST' });
                showToast(response.message, 'success');
                fetchDashboardData();
            } catch (error) {
                showToast(error.message, 'danger');
            } finally {
                hideSpinner();
            }
        }
    );
}

async function toggleExclusion(deviceId, exclude) {
    showSpinner();
    try {
        const response = await apiFetch(`/api/devices/${deviceId}/exclude`, {
            method: 'PUT',
            body: JSON.stringify({ is_excluded: exclude }),
        });
        showToast(response.message, 'success');
        fetchDevices();
    } catch (error) {
        showToast(error.message, 'danger');
    } finally {
        hideSpinner();
    }
}

// --- UTILIDADES ---

function updateSortIndicator() {
    document.querySelectorAll('.sortable span').forEach(span => span.textContent = '');
    const activeHeader = document.querySelector(`.sortable[data-sort="${state.sortBy}"] span`);
    if (activeHeader) {
        activeHeader.textContent = state.sortOrder === 'asc' ? ' ▲' : ' ▼';
    }
}

function startAutoRefresh() {
    if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = setInterval(() => {
        if (state.autoRefresh && document.getElementById('dashboard-view').offsetParent !== null) {
            console.log("Auto-refrescando datos del dashboard...");
            fetchDashboardData();
        }
    }, 10000); // Cada 10 segundos
}

function stopAutoRefresh() {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
}

function formatRelativeTime(isoString) {
    if (!isoString) return 'N/A';
    return dayjs.utc(isoString).fromNow();
}

function formatFullDateTime(isoString) {
    if (!isoString) return 'N/A';
    return dayjs.utc(isoString).local().format('DD/MM/YYYY HH:mm:ss');
}

function formatLeaseTime(startTime, durationSeconds) {
    if (!startTime || durationSeconds === null) return 'N/A';
    
    const leaseEnd = dayjs.utc(startTime).add(durationSeconds, 'second');
    const now = dayjs.utc();

    if (now.isAfter(leaseEnd)) {
        return 'Expirado';
    }
    
    return leaseEnd.from(now, true); // 'en 2 horas' -> '2 horas'
}

function getStatusClass(status) {
    switch (status) {
        case 'active': return 'bg-success';
        case 'inactive': return 'bg-warning text-dark';
        case 'released': return 'bg-secondary';
        default: return 'bg-light text-dark';
    }
}

let toastCounter = 0;
function showToast(message, type = 'info') {
    const area = document.getElementById('notification-area');
    const toastId = `toast-${toastCounter++}`;
    const toastHTML = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;
    area.insertAdjacentHTML('beforeend', toastHTML);
    const toastEl = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

function showSpinner() {
    document.getElementById('spinner-overlay').classList.remove('d-none');
}

function hideSpinner() {
    document.getElementById('spinner-overlay').classList.add('d-none');
}

function showConfirmationModal(bodyText, confirmCallback) {
    const modal = new bootstrap.Modal(document.getElementById('confirmationModal'));
    document.getElementById('confirmationModalBody').textContent = bodyText;
    
    const confirmButton = document.getElementById('confirmActionButton');
    
    // Clonamos el botón para remover listeners antiguos
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    
    newConfirmButton.addEventListener('click', () => {
        modal.hide();
        confirmCallback();
    });
    
    modal.show();
}

function renderDryRunBanner(isDryRunEnabled) {
    const banner = document.getElementById('dry-run-banner');
    if (isDryRunEnabled) {
        banner.innerHTML = `
            <div class="alert alert-warning" role="alert">
                <strong>Modo Simulación (Dry Run) Activado.</strong> No se ejecutarán acciones reales de liberación de IP.
            </div>
        `;
    } else {
        banner.innerHTML = '';
    }
}


// --- Lógica para los gráficos y logs (sin cambios) ---

let charts = {};
async function fetchHistoricalStats(period = '7d') {
    showSpinner();
    try {
        const data = await apiFetch(`/api/stats/historical?period=${period}`);
        renderCharts(data);
    } catch (error) {
        console.error('Error fetching historical stats:', error);
        showToast(error.message, 'danger');
    } finally {
        hideSpinner();
    }
}

function renderCharts(data) {
    const chartColors = {
        releases_inactivity: 'rgba(255, 159, 64, 0.7)',
        releases_mac_list: 'rgba(255, 99, 132, 0.7)',
        releases_manual: 'rgba(201, 203, 207, 0.7)',
        active_devices_peak: 'rgba(75, 192, 192, 0.7)',
        total_devices_snapshot: 'rgba(54, 162, 235, 0.7)',
    };
    
    const commonOptions = {
        scales: { y: { beginAtZero: true } },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { position: 'nearest' } },
        responsive: true,
        maintainAspectRatio: false,
    };

    // Gráfico de Liberaciones
    if (charts.releases) charts.releases.destroy();
    const releasesCtx = document.getElementById('releases-chart').getContext('2d');
    charts.releases = new Chart(releasesCtx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: data.datasets.releases.map(ds => ({
                ...ds,
                backgroundColor: chartColors[ds.label.toLowerCase().includes('inactividad') ? 'releases_inactivity' : ds.label.toLowerCase().includes('mac') ? 'releases_mac_list' : 'releases_manual']
            })),
        },
        options: { ...commonOptions, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });
    
    // Gráfico de Actividad
    if (charts.activity) charts.activity.destroy();
    const activityCtx = document.getElementById('activity-chart').getContext('2d');
    charts.activity = new Chart(activityCtx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: data.datasets.activity.map(ds => ({
                ...ds,
                borderColor: chartColors[ds.label.toLowerCase().includes('pico') ? 'active_devices_peak' : 'total_devices_snapshot'],
                backgroundColor: chartColors[ds.label.toLowerCase().includes('pico') ? 'active_devices_peak' : 'total_devices_snapshot'],
                fill: false,
                tension: 0.1
            })),
        },
        options: commonOptions
    });
}

async function fetchLogs(eventType = 'all') {
    showSpinner();
    try {
        const logs = await apiFetch(`/api/logs?event_type=${eventType}`);
        renderLogs(logs);
    } catch (error) {
        console.error('Error fetching logs:', error);
        showToast(error.message, 'danger');
    } finally {
        hideSpinner();
    }
}

function renderLogs(logs) {
    const list = document.getElementById('logs-list');
    list.innerHTML = '';
    if (logs.length === 0) {
        list.innerHTML = '<div class="list-group-item">No hay registros para mostrar.</div>';
        return;
    }

    const logBadges = {
        'INFO': 'bg-primary',
        'WARNING': 'bg-warning text-dark',
        'ERROR': 'bg-danger'
    };

    logs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex justify-content-between align-items-start';
        item.innerHTML = `
            <div class="ms-2 me-auto">
                <div class="fw-bold">${formatFullDateTime(log.timestamp)} <span class="badge ${logBadges[log.level] || 'bg-secondary'}">${log.level}</span></div>
                ${log.message}
            </div>
        `;
        list.appendChild(item);
    });
}
