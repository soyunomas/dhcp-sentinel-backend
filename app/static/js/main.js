document.addEventListener('DOMContentLoaded', () => {
    // === CONFIGURACIÓN GLOBAL Y ESTADO ===
    const API_BASE_URL = '/api';
    let appState = {
        currentPage: 1,
        perPage: 50,
        sortBy: 'last_seen',
        sortOrder: 'desc',
        searchTerm: '',
        autoRefresh: true,
    };
    let autoRefreshInterval = null;
    const REFRESH_INTERVAL_MS = 10000;
    
    // Instancias de los gráficos para poder destruirlas y recrearlas
    let releasesChart = null;
    let activityChart = null;


    // === ELEMENTOS DEL DOM ===
    const spinner = document.getElementById('spinner-overlay');
    const searchInput = document.getElementById('search-input');
    const perPageSelect = document.getElementById('per-page-select');
    const autoRefreshSwitch = document.getElementById('auto-refresh-switch');
    const confirmationModalEl = document.getElementById('confirmationModal');
    const confirmationModal = new bootstrap.Modal(confirmationModalEl);

    const views = {
        dashboard: document.getElementById('dashboard-view'),
        stats: document.getElementById('stats-view'),
        config: document.getElementById('config-view'),
        logs: document.getElementById('logs-view'),
    };

    const navLinks = {
        dashboard: document.getElementById('nav-dashboard'),
        stats: document.getElementById('nav-stats'),
        config: document.getElementById('nav-config'),
        logs: document.getElementById('nav-logs'),
    };


    // === INICIALIZACIÓN ===
    function init() {
        setupEventListeners();
        loadInitialData();
        startAutoRefresh();
    }

    // === MANEJO DE VISTAS Y NAVEGACIÓN ===
    function showView(viewName) {
        Object.values(views).forEach(view => view.classList.add('d-none'));
        Object.values(navLinks).forEach(link => link.classList.remove('active'));
        
        if (views[viewName]) {
            views[viewName].classList.remove('d-none');
            navLinks[viewName].classList.add('active');
        }

        // Cargar datos específicos de la vista si es necesario
        switch (viewName) {
            case 'dashboard':
                fetchDataForDashboard();
                break;
            case 'stats':
                // Cargar con el período por defecto (7 días)
                fetchAndRenderStats('7d'); 
                break;
            case 'config':
                fetchConfig();
                break;
            case 'logs':
                fetchLogs();
                break;
        }
    }

    // === LÓGICA DE CARGA DE DATOS ===
    async function fetchWithSpinner(url, options = {}) {
        spinner.classList.remove('d-none');
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Fetch error:', error);
            showNotification(`Error: ${error.message}`, 'danger');
            throw error; // Propagar el error para que el llamador pueda manejarlo
        } finally {
            spinner.classList.add('d-none');
        }
    }

    function loadInitialData() {
        dayjs.extend(dayjs_plugin_relativeTime);
        dayjs.extend(dayjs_plugin_localizedFormat);
        dayjs.extend(dayjs_plugin_utc);
        dayjs.locale('es');

        perPageSelect.value = appState.perPage;
        showView('dashboard');
        fetchConfig(); // Cargar la configuración para mostrar el banner de Dry Run
    }
    
    function fetchDataForDashboard() {
        fetchStats();
        fetchDevices();
    }
    
    // === FUNCIONES DE LA API (FETCH) ===
    async function fetchDevices() {
        const { currentPage, perPage, sortBy, sortOrder, searchTerm } = appState;
        const url = `${API_BASE_URL}/devices?page=${currentPage}&per_page=${perPage}&sort_by=${sortBy}&order=${sortOrder}&search=${searchTerm}`;
        try {
            const data = await fetchWithSpinner(url);
            renderDevicesTable(data.items);
            renderPagination(data.pagination);
            updateSortIndicators();
        } catch (error) {
            console.error("No se pudieron cargar los dispositivos.");
        }
    }

    async function fetchStats() {
        try {
            const data = await fetch(`${API_BASE_URL}/stats`).then(res => res.json());
            document.getElementById('stats-total-devices').textContent = data.total_devices;
            document.getElementById('stats-active-devices').textContent = data.active_devices;
            document.getElementById('stats-released-ips').textContent = data.released_ips;
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    }

    async function fetchConfig() {
        try {
            const config = await fetchWithSpinner(`${API_BASE_URL}/config`);
            const form = document.getElementById('config-form');
            form.scan_subnet.value = config.scan_subnet;
            form.dhcp_server_ip.value = config.dhcp_server_ip;
            form.network_interface.value = config.network_interface;
            form.auto_release_threshold_hours.value = config.auto_release_threshold_hours;
            form.mac_auto_release_list.value = config.mac_auto_release_list;
            form.dry_run_enabled.checked = config.dry_run_enabled;
            renderDryRunBanner(config.dry_run_enabled);
        } catch (error) {
            console.error("No se pudo cargar la configuración.");
        }
    }

    async function fetchLogs() {
        try {
            const logs = await fetchWithSpinner(`${API_BASE_URL}/logs?limit=200`);
            renderLogs(logs);
        } catch (error) {
            console.error("No se pudieron cargar los logs.");
        }
    }

    // === NUEVA FUNCIÓN PARA ESTADÍSTICAS HISTÓRICAS ===
    async function fetchAndRenderStats(period = '7d') {
        try {
            const data = await fetchWithSpinner(`${API_BASE_URL}/stats/historical?period=${period}`);
            renderReleasesChart(data);
            renderActivityChart(data);

            // Actualizar el estado activo de los botones del período
            document.querySelectorAll('.period-selector').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.add('btn-outline-primary');
                btn.classList.remove('btn-primary');
                if (btn.dataset.period === period) {
                    btn.classList.add('active', 'btn-primary');
                    btn.classList.remove('btn-outline-primary');
                }
            });

        } catch (error) {
            console.error(`No se pudieron cargar las estadísticas para el período ${period}.`);
        }
    }


    // === LÓGICA DE RENDERIZADO ===
    function renderDevicesTable(devices) {
        const tableBody = document.getElementById('devices-table-body');
        tableBody.innerHTML = '';
        if (devices.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No se encontraron dispositivos.</td></tr>';
            return;
        }

        devices.forEach(device => {
            const lastSeen = device.last_seen ? dayjs.utc(device.last_seen).fromNow() : 'Nunca';
            const statusBadge = getStatusBadge(device.status);
            const excludedBadge = device.is_excluded ? '<span class="badge bg-warning">Sí</span>' : '<span class="badge bg-light text-dark">No</span>';
            const actions = `
                <button class="btn btn-sm btn-info" onclick="window.app.releaseIp(${device.id}, '${device.ip_address}')" title="Liberar IP">Liberar</button>
                <button class="btn btn-sm ${device.is_excluded ? 'btn-success' : 'btn-warning'}" onclick="window.app.toggleExclusion(${device.id}, ${!device.is_excluded})" title="${device.is_excluded ? 'Incluir dispositivo' : 'Excluir dispositivo'}">
                    ${device.is_excluded ? 'Incluir' : 'Excluir'}
                </button>
            `;
            const row = `
                <tr>
                    <td>${device.ip_address}</td>
                    <td>${device.mac_address}</td>
                    <td>${device.vendor || 'Desconocido'}</td>
                    <td title="${dayjs.utc(device.last_seen).format('YYYY-MM-DD HH:mm:ss Z')}">${lastSeen}</td>
                    <td>${statusBadge}</td>
                    <td>${excludedBadge}</td>
                    <td>${actions}</td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
    }

    function renderPagination(pagination) {
        const controls = document.getElementById('pagination-controls');
        if (pagination.total_pages <= 1) {
            controls.innerHTML = '';
            return;
        }

        let html = '<ul class="pagination pagination-sm mb-0">';
        html += `<li class="page-item ${pagination.has_prev ? '' : 'disabled'}">
                    <a class="page-link" href="#" data-page="${pagination.page - 1}">Anterior</a>
                 </li>`;
        
        // Lógica para mostrar un número limitado de páginas
        const startPage = Math.max(1, pagination.page - 2);
        const endPage = Math.min(pagination.total_pages, pagination.page + 2);
        
        if (startPage > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
            if (startPage > 2) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        
        for (let i = startPage; i <= endPage; i++) {
            html += `<li class="page-item ${i === pagination.page ? 'active' : ''}">
                        <a class="page-link" href="#" data-page="${i}">${i}</a>
                     </li>`;
        }

        if (endPage < pagination.total_pages) {
            if (endPage < pagination.total_pages - 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${pagination.total_pages}">${pagination.total_pages}</a></li>`;
        }

        html += `<li class="page-item ${pagination.has_next ? '' : 'disabled'}">
                    <a class="page-link" href="#" data-page="${pagination.page + 1}">Siguiente</a>
                 </li>`;
        html += '</ul>';
        controls.innerHTML = html;
    }

    function renderLogs(logs) {
        const list = document.getElementById('logs-list');
        list.innerHTML = logs.map(log => {
            const levelClass = {
                'INFO': 'list-group-item-light',
                'WARNING': 'list-group-item-warning',
                'ERROR': 'list-group-item-danger'
            }[log.level] || '';
            const timestamp = dayjs.utc(log.timestamp).local().format('YYYY-MM-DD HH:mm:ss');
            return `<div class="list-group-item ${levelClass}">
                        <div class="d-flex w-100 justify-content-between">
                            <p class="mb-1">${log.message}</p>
                            <small>${timestamp}</small>
                        </div>
                    </div>`;
        }).join('');
    }

    function renderDryRunBanner(isEnabled) {
        const banner = document.getElementById('dry-run-banner');
        if (isEnabled) {
            banner.innerHTML = `
                <div class="alert alert-warning text-center" role="alert">
                    <strong>Modo Simulación (Dry Run) Activado.</strong> No se realizarán cambios reales en la red.
                </div>`;
        } else {
            banner.innerHTML = '';
        }
    }
    
    // === NUEVAS FUNCIONES PARA RENDERIZAR GRÁFICOS ===
    function renderReleasesChart(data) {
        const ctx = document.getElementById('releases-chart').getContext('2d');
        if (releasesChart) {
            releasesChart.destroy();
        }
        releasesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: data.datasets.releases[0].label, // Inactividad
                        data: data.datasets.releases[0].data,
                        backgroundColor: 'rgba(255, 159, 64, 0.7)',
                    },
                    {
                        label: data.datasets.releases[1].label, // Lista MAC
                        data: data.datasets.releases[1].data,
                        backgroundColor: 'rgba(255, 99, 132, 0.7)',
                    },
                    {
                        label: data.datasets.releases[2].label, // Manual
                        data: data.datasets.releases[2].data,
                        backgroundColor: 'rgba(54, 162, 235, 0.7)',
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'IPs Liberadas por Día y Causa'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true
                    }
                }
            }
        });
    }

    function renderActivityChart(data) {
        const ctx = document.getElementById('activity-chart').getContext('2d');
        if (activityChart) {
            activityChart.destroy();
        }
        activityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: data.datasets.activity[0].label, // Pico Activos
                        data: data.datasets.activity[0].data,
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        fill: true,
                        tension: 0.1
                    },
                    {
                        label: data.datasets.activity[1].label, // Total Conocidos
                        data: data.datasets.activity[1].data,
                        borderColor: 'rgb(153, 102, 255)',
                        backgroundColor: 'rgba(153, 102, 255, 0.2)',
                        fill: false,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Evolución de Dispositivos en la Red'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // === MANEJO DE EVENTOS ===
    function setupEventListeners() {
        // Navegación
        Object.keys(navLinks).forEach(key => {
            navLinks[key].addEventListener('click', (e) => {
                e.preventDefault();
                showView(key);
            });
        });

        // Búsqueda
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                appState.searchTerm = searchInput.value;
                appState.currentPage = 1;
                fetchDevices();
            }, 300);
        });
        
        // Paginación
        document.getElementById('pagination-controls').addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.dataset.page) {
                e.preventDefault();
                appState.currentPage = parseInt(e.target.dataset.page, 10);
                fetchDevices();
            }
        });

        // Selección de por página
        perPageSelect.addEventListener('change', () => {
            appState.perPage = parseInt(perPageSelect.value, 10);
            appState.currentPage = 1;
            fetchDevices();
        });

        // Ordenación de columnas
        document.querySelector('.table thead').addEventListener('click', (e) => {
            const header = e.target.closest('th[data-sort]');
            if (header) {
                const sortBy = header.dataset.sort;
                if (appState.sortBy === sortBy) {
                    appState.sortOrder = appState.sortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    appState.sortBy = sortBy;
                    appState.sortOrder = 'desc';
                }
                fetchDevices();
            }
        });

        // Auto-refresco
        autoRefreshSwitch.addEventListener('change', () => {
            appState.autoRefresh = autoRefreshSwitch.checked;
            if (appState.autoRefresh) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
        
        // Formulario de configuración
        document.getElementById('config-form').addEventListener('submit', handleSaveConfig);

        // Limpiar base de datos
        document.getElementById('clear-database-btn').addEventListener('click', handleClearDatabase);
        
        // Selector de período para estadísticas
        document.querySelectorAll('.period-selector').forEach(button => {
            button.addEventListener('click', (e) => {
                const period = e.target.dataset.period;
                fetchAndRenderStats(period);
            });
        });
    }


    // === MANEJADORES DE ACCIONES (HANDLERS) ===
    async function handleSaveConfig(e) {
        e.preventDefault();
        const form = e.target;
        const data = {
            scan_subnet: form.scan_subnet.value,
            dhcp_server_ip: form.dhcp_server_ip.value,
            network_interface: form.network_interface.value,
            auto_release_threshold_hours: parseInt(form.auto_release_threshold_hours.value, 10),
            mac_auto_release_list: form.mac_auto_release_list.value,
            dry_run_enabled: form.dry_run_enabled.checked
        };

        try {
            const result = await fetchWithSpinner(`${API_BASE_URL}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            showNotification(result.message, 'success');
            renderDryRunBanner(result.config.dry_run_enabled);
        } catch (error) {
            console.error("Error al guardar la configuración.");
        }
    }

    function handleClearDatabase() {
        showConfirmationModal(
            '¿Estás seguro de que quieres limpiar la base de datos?',
            'Esta acción es irreversible y eliminará todos los dispositivos, logs y estadísticas históricas.',
            async () => {
                try {
                    const result = await fetchWithSpinner(`${API_BASE_URL}/database/clear`, { method: 'POST' });
                    showNotification(result.message, 'success');
                    if (views.dashboard.classList.contains('d-none') === false) {
                        fetchDataForDashboard();
                    }
                    if (views.logs.classList.contains('d-none') === false) {
                        fetchLogs();
                    }
                    if (views.stats.classList.contains('d-none') === false) {
                        fetchAndRenderStats();
                    }
                } catch (error) {
                    console.error("Error al limpiar la base de datos.");
                }
            }
        );
    }
    
    // === FUNCIONES DE UTILIDAD ===
    function getStatusBadge(status) {
        switch (status) {
            case 'active': return '<span class="badge bg-success">Activo</span>';
            case 'inactive': return '<span class="badge bg-secondary">Inactivo</span>';
            case 'released': return '<span class="badge bg-dark">Liberado</span>';
            default: return `<span class="badge bg-light text-dark">${status}</span>`;
        }
    }
    
    function updateSortIndicators() {
        document.querySelectorAll('th[data-sort]').forEach(th => {
            const span = th.querySelector('span');
            if (th.dataset.sort === appState.sortBy) {
                span.textContent = appState.sortOrder === 'asc' ? ' ▲' : ' ▼';
            } else {
                span.textContent = '';
            }
        });
    }

    function showNotification(message, type = 'info') {
        const toastContainer = document.getElementById('notification-area');
        const toastId = `toast-${Date.now()}`;
        const toastHTML = `
            <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="5000">
                <div class="toast-header bg-${type} ${type === 'info' || type === 'light' ? '' : 'text-white'}">
                    <strong class="me-auto">${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
                    <button type="button" class="btn-close ${type === 'info' || type === 'light' ? '' : 'btn-close-white'}" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">
                    ${message}
                </div>
            </div>`;
        toastContainer.insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    }

    function showConfirmationModal(title, body, onConfirm) {
        confirmationModalEl.querySelector('#confirmationModalLabel').textContent = title;
        confirmationModalEl.querySelector('#confirmationModalBody').textContent = body;
        
        const confirmBtn = confirmationModalEl.querySelector('#confirmActionButton');
        // Clonar para remover listeners antiguos
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

        newConfirmBtn.addEventListener('click', () => {
            onConfirm();
            confirmationModal.hide();
        });

        confirmationModal.show();
    }

    // === MANEJO DE AUTO-REFRESCO ===
    function startAutoRefresh() {
        if (!autoRefreshInterval && appState.autoRefresh) {
            autoRefreshInterval = setInterval(() => {
                // Solo refresca la vista activa
                if (!views.dashboard.classList.contains('d-none')) {
                    fetchDataForDashboard();
                }
            }, REFRESH_INTERVAL_MS);
        }
    }
    
    function stopAutoRefresh() {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    

    // === EXPOSICIÓN DE FUNCIONES GLOBALES (para onclick) ===
    window.app = {
        releaseIp: (deviceId, ipAddress) => {
            showConfirmationModal(
                `Liberar IP ${ipAddress}`,
                '¿Estás seguro de que quieres enviar una solicitud DHCPRELEASE para este dispositivo?',
                async () => {
                    try {
                        const result = await fetchWithSpinner(`${API_BASE_URL}/devices/${deviceId}/release`, { method: 'POST' });
                        showNotification(result.message, 'success');
                        fetchDevices();
                        fetchStats();
                    } catch (error) {
                        console.error("Error al liberar la IP.");
                    }
                }
            );
        },
        toggleExclusion: async (deviceId, isExcluded) => {
            const action = isExcluded ? "excluir" : "incluir";
            try {
                const result = await fetchWithSpinner(`${API_BASE_URL}/devices/${deviceId}/exclude`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_excluded: isExcluded }),
                });
                showNotification(result.message, 'success');
                fetchDevices();
            } catch (error) {
                console.error(`Error al ${action} el dispositivo.`);
            }
        }
    };

    // Iniciar la aplicación
    init();
});
