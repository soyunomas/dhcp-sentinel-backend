// app/static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURACIÓN E INICIALIZACIÓN ---
    dayjs.extend(dayjs_plugin_relativeTime);
    dayjs.extend(dayjs_plugin_localizedFormat);
    dayjs.extend(dayjs_plugin_utc);
    dayjs.locale('es');

    // Estado global de la aplicación
    const appState = {
        currentPage: 1,
        perPage: 50,
        sortBy: 'last_seen',
        sortOrder: 'desc',
        searchTerm: '',
        currentView: 'dashboard',
        autoRefreshIntervalId: null,
        autoRefreshEnabled: true,
        logFilter: 'all',
        statsPeriod: '7d',
        charts: {}
    };

    // Referencias a elementos del DOM
    const elements = {
        views: {
            dashboard: document.getElementById('dashboard-view'),
            config: document.getElementById('config-view'),
            logs: document.getElementById('logs-view'),
            stats: document.getElementById('stats-view'),
        },
        navLinks: {
            dashboard: document.getElementById('nav-dashboard'),
            config: document.getElementById('nav-config'),
            logs: document.getElementById('nav-logs'),
            stats: document.getElementById('nav-stats'),
        },
        deviceTableBody: document.getElementById('devices-table-body'),
        paginationControls: document.getElementById('pagination-controls'),
        searchInput: document.getElementById('search-input'),
        perPageSelect: document.getElementById('per-page-select'),
        autoRefreshSwitch: document.getElementById('auto-refresh-switch'),
        spinnerOverlay: document.getElementById('spinner-overlay'),
        notificationArea: document.getElementById('notification-area'),
        configForm: document.getElementById('config-form'),
        clearDbBtn: document.getElementById('clear-database-btn'),
        logsList: document.getElementById('logs-list'),
        logFilterSelect: document.getElementById('log-filter-select'),
        dryRunBanner: document.getElementById('dry-run-banner'),
        statCards: {
            total: document.getElementById('stats-total-devices'),
            active: document.getElementById('stats-active-devices'),
            released: document.getElementById('stats-released-ips'),
        },
        statsPeriodSelectors: document.querySelectorAll('.period-selector'),
        charts: {
            releases: document.getElementById('releases-chart'),
            activity: document.getElementById('activity-chart'),
        }
    };

    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

    // --- MANEJO DE VISTAS ---
    const switchView = (viewName) => {
        appState.currentView = viewName;
        Object.values(elements.views).forEach(view => view.classList.add('d-none'));
        Object.values(elements.navLinks).forEach(link => link.classList.remove('active'));

        if (elements.views[viewName]) {
            elements.views[viewName].classList.remove('d-none');
            elements.navLinks[viewName].classList.add('active');
        }

        // Acciones específicas al cambiar de vista
        switch (viewName) {
            case 'dashboard':
                fetchDevicesAndStats();
                break;
            case 'config':
                fetchConfig();
                break;
            case 'logs':
                fetchLogs();
                break;
            case 'stats':
                fetchHistoricalStats();
                break;
        }
    };

    // --- MANEJO DE CARGA Y NOTIFICACIONES ---
    const showSpinner = () => elements.spinnerOverlay.classList.remove('d-none');
    const hideSpinner = () => elements.spinnerOverlay.classList.add('d-none');

    const showToast = (message, type = 'success') => {
        const toastId = `toast-${Date.now()}`;
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
        elements.notificationArea.insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    };

    // --- FUNCIONES DE API ---
    const apiFetch = async (url, options = {}) => {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        };
        const mergedOptions = { ...defaultOptions, ...options };
        mergedOptions.headers = { ...defaultOptions.headers, ...options.headers };

        try {
            const response = await fetch(url, mergedOptions);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Error HTTP ${response.status}` }));
                throw new Error(errorData.error || `Error en la solicitud: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            console.error('Error en apiFetch:', error);
            showToast(error.message, 'danger');
            throw error;
        }
    };

    const fetchDevices = async () => {
        const { currentPage, perPage, sortBy, sortOrder, searchTerm } = appState;
        const url = `/api/devices?page=${currentPage}&per_page=${perPage}&sort_by=${sortBy}&order=${sortOrder}&search=${encodeURIComponent(searchTerm)}`;
        try {
            const data = await apiFetch(url);
            renderTable(data.items);
            renderPagination(data.pagination);
        } catch (error) {
            // Error ya manejado por apiFetch
        }
    };
    
    const fetchGeneralStats = async () => {
        try {
            const stats = await apiFetch('/api/stats');
            elements.statCards.total.textContent = stats.total_devices;
            elements.statCards.active.textContent = stats.active_devices;
            elements.statCards.released.textContent = stats.released_ips;
        } catch (error) {
            // Error ya manejado por apiFetch
        }
    };

    const fetchDevicesAndStats = () => {
        fetchDevices();
        fetchGeneralStats();
    };

    const fetchConfig = async () => {
        try {
            const config = await apiFetch('/api/config');
            Object.keys(config).forEach(key => {
                const input = elements.configForm.querySelector(`[name="${key}"]`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = config[key];
                    } else {
                        input.value = config[key];
                    }
                }
            });
            updateDryRunBanner(config.dry_run_enabled);
        } catch (error) {
            // Error ya manejado por apiFetch
        }
    };
    
    const fetchLogs = async () => {
        try {
            const logs = await apiFetch(`/api/logs?limit=200&event_type=${appState.logFilter}`);
            renderLogs(logs);
        } catch (error) {
            // Error ya manejado por apiFetch
        }
    };

    const fetchHistoricalStats = async () => {
        showSpinner();
        try {
            const data = await apiFetch(`/api/stats/historical?period=${appState.statsPeriod}`);
            renderCharts(data);
        } catch (error) {
            // Silencioso, el error ya se muestra en toast
        } finally {
            hideSpinner();
        }
    };

    // --- FUNCIONES DE RENDERIZADO ---
    const renderTable = (devices) => {
        elements.deviceTableBody.innerHTML = '';
        if (devices.length === 0) {
            elements.deviceTableBody.innerHTML = '<tr><td colspan="9" class="text-center">No se encontraron dispositivos.</td></tr>';
            return;
        }

        const rows = devices.map(device => {
            const lastSeen = device.last_seen ? dayjs(device.last_seen).fromNow() : 'Nunca';
            
            let leaseInfo = 'N/A';
            if (device.lease_start_time && device.lease_duration_seconds) {
                const leaseEnd = dayjs(device.lease_start_time).add(device.lease_duration_seconds, 'second');
                const now = dayjs();
                if (leaseEnd.isAfter(now)) {
                    leaseInfo = leaseEnd.fromNow(true);
                } else {
                    leaseInfo = 'Expirado';
                }
            }

            const statusBadge = {
                'active': 'bg-success',
                'inactive': 'bg-warning text-dark',
                'released': 'bg-secondary'
            }[device.status] || 'bg-light text-dark';
            
            const lastSeenByBadge = {
                'nmap': 'bg-primary',
                'sniffer': 'bg-info text-dark'
            }[device.last_seen_by] || 'bg-secondary';
            
            const isExcludedText = device.is_excluded ? 'Sí' : 'No';
            const excludeButtonText = device.is_excluded ? 'Incluir' : 'Excluir';
            const excludeButtonClass = device.is_excluded ? 'btn-outline-secondary' : 'btn-secondary';
            
            return `
                <tr>
                    <td>${device.ip_address}</td>
                    <td>${device.mac_address}</td>
                    <td>${device.vendor}</td>
                    <td>${lastSeen}</td>
                    <td>${leaseInfo}</td>
                    <td><span class="badge ${statusBadge}">${device.status}</span></td>
                    <td><span class="badge ${lastSeenByBadge}">${device.last_seen_by || 'N/A'}</span></td>
                    <td>${isExcludedText}</td>
                    <td class="actions-cell">
                        <button class="btn btn-sm btn-primary action-btn" data-action="release" data-id="${device.id}" title="Liberar IP">Liberar</button>
                        <button class="btn btn-sm btn-info action-btn" data-action="ping" data-id="${device.id}" title="Hacer Ping">Ping</button>
                        <button class="btn btn-sm ${excludeButtonClass} action-btn" data-action="toggle-exclude" data-id="${device.id}" data-excluded="${device.is_excluded}" title="${excludeButtonText} de la liberación automática">${excludeButtonText}</button>
                    </td>
                </tr>
            `;
        }).join('');
        elements.deviceTableBody.innerHTML = rows;
    };

    const renderPagination = (pagination) => {
        const { page, total_pages, has_prev, has_next } = pagination;
        let html = '';
        if (total_pages > 1) {
            html += `<button class="btn btn-outline-secondary" ${has_prev ? '' : 'disabled'} data-page="${page - 1}">Anterior</button>`;
            
            // Lógica para mostrar un rango de páginas
            const start = Math.max(1, page - 2);
            const end = Math.min(total_pages, page + 2);

            if (start > 1) {
                html += `<button class="btn btn-outline-secondary" data-page="1">1</button>`;
                if (start > 2) html += `<span class="btn disabled">...</span>`;
            }

            for (let i = start; i <= end; i++) {
                html += `<button class="btn ${i === page ? 'btn-primary' : 'btn-outline-secondary'}" data-page="${i}">${i}</button>`;
            }

            if (end < total_pages) {
                if (end < total_pages - 1) html += `<span class="btn disabled">...</span>`;
                html += `<button class="btn btn-outline-secondary" data-page="${total_pages}">${total_pages}</button>`;
            }

            html += `<button class="btn btn-outline-secondary" ${has_next ? '' : 'disabled'} data-page="${page + 1}">Siguiente</button>`;
        }
        elements.paginationControls.innerHTML = html;
    };

    const renderLogs = (logs) => {
        elements.logsList.innerHTML = '';
        if (logs.length === 0) {
            elements.logsList.innerHTML = '<div class="list-group-item">No hay eventos para mostrar.</div>';
            return;
        }

        const logItems = logs.map(log => {
            const levelBadge = {
                'INFO': 'list-group-item-info',
                'WARNING': 'list-group-item-warning',
                'ERROR': 'list-group-item-danger'
            }[log.level] || 'list-group-item-light';
            
            // --- [CORRECCIÓN DE ZONA HORARIA] ---
            // Interpreta la fecha como UTC y la convierte a la hora local del navegador antes de formatearla.
            const formattedTimestamp = dayjs.utc(log.timestamp).local().format('DD/MM/YYYY HH:mm:ss');

            return `
                <div class="list-group-item ${levelBadge}">
                    <div class="d-flex w-100 justify-content-between">
                        <p class="mb-1">${log.message}</p>
                        <small>${formattedTimestamp}</small>
                    </div>
                </div>
            `;
        }).join('');
        elements.logsList.innerHTML = logItems;
    };

    const updateDryRunBanner = (isEnabled) => {
        if (isEnabled) {
            elements.dryRunBanner.innerHTML = `
                <div class="alert alert-warning" role="alert">
                    <strong>Modo de Simulación (Dry Run) Activado.</strong> Las acciones de liberación automática y manual solo serán registradas, no ejecutadas.
                </div>
            `;
        } else {
            elements.dryRunBanner.innerHTML = '';
        }
    };
    
    const renderCharts = (data) => {
        const chartColors = {
            releases: {
                inactivity: 'rgba(255, 99, 132, 0.7)',
                mac_list: 'rgba(54, 162, 235, 0.7)',
                manual: 'rgba(255, 206, 86, 0.7)',
            },
            activity: {
                peak: 'rgba(75, 192, 192, 0.7)',
                total: 'rgba(153, 102, 255, 0.7)',
            }
        };

        const createOrUpdateChart = (chartId, context, type, labels, datasets, options = {}) => {
            if (appState.charts[chartId]) {
                appState.charts[chartId].data.labels = labels;
                appState.charts[chartId].data.datasets = datasets;
                appState.charts[chartId].update();
            } else {
                appState.charts[chartId] = new Chart(context, {
                    type: type,
                    data: { labels, datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        scales: { y: { beginAtZero: true } },
                        ...options
                    }
                });
            }
        };

        // Gráfico de Liberaciones
        const releaseDatasets = data.datasets.releases.map(ds => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: chartColors.releases[ds.label.includes('Inactividad') ? 'inactivity' : ds.label.includes('MAC') ? 'mac_list' : 'manual'],
        }));
        createOrUpdateChart('releases', elements.charts.releases.getContext('2d'), 'bar', data.labels, releaseDatasets, {
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        });

        // Gráfico de Actividad
        const activityDatasets = data.datasets.activity.map(ds => ({
            label: ds.label,
            data: ds.data,
            borderColor: chartColors.activity[ds.label.includes('Pico') ? 'peak' : 'total'],
            backgroundColor: chartColors.activity[ds.label.includes('Pico') ? 'peak' : 'total'].replace('0.7', '0.2'),
            fill: true,
            tension: 0.1
        }));
        createOrUpdateChart('activity', elements.charts.activity.getContext('2d'), 'line', data.labels, activityDatasets);
    };


    // --- MANEJO DE ACCIONES DEL USUARIO ---
    const handleActionClick = (e) => {
        const target = e.target.closest('.action-btn');
        if (!target) return;

        const action = target.dataset.action;
        const deviceId = target.dataset.id;
        
        switch (action) {
            case 'release':
                confirmAndExecute(
                    `¿Estás seguro de que quieres liberar la IP de este dispositivo?`,
                    () => apiFetch(`/api/devices/${deviceId}/release`, { method: 'POST' }),
                    'IP liberada correctamente.',
                    'Error al liberar la IP.'
                );
                break;
            case 'ping':
                handlePing(deviceId);
                break;
            case 'toggle-exclude':
                const isExcluded = target.dataset.excluded === 'true';
                const newState = !isExcluded;
                const actionText = newState ? 'excluir' : 'incluir';
                confirmAndExecute(
                    `¿Estás seguro de que quieres ${actionText} este dispositivo de las liberaciones automáticas?`,
                    () => apiFetch(`/api/devices/${deviceId}/exclude`, { method: 'PUT', body: JSON.stringify({ is_excluded: newState }) }),
                    `Dispositivo ${actionText.slice(0, -1)}ido correctamente.`,
                    `Error al ${actionText} el dispositivo.`
                );
                break;
        }
    };

    const handlePing = async (deviceId) => {
        showSpinner();
        try {
            const result = await apiFetch(`/api/devices/${deviceId}/ping`, { method: 'POST' });
            if (result.status === 'online') {
                showToast(`El dispositivo ${result.ip_address} está en línea y responde al ping.`, 'success');
            } else {
                showToast(`El dispositivo ${result.ip_address} no responde al ping.`, 'warning');
            }
        } catch (error) {
            // Ya manejado por apiFetch
        } finally {
            hideSpinner();
        }
    };
    
    // --- LÓGICA DE CONFIRMACIÓN MODAL ---
    const confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
    let onConfirmCallback = null;
    
    document.getElementById('confirmActionButton').addEventListener('click', () => {
        if (onConfirmCallback) {
            onConfirmCallback();
        }
        confirmationModal.hide();
    });

    const confirmAndExecute = async (message, actionCallback, successMessage, errorMessage) => {
        document.getElementById('confirmationModalBody').textContent = message;
        
        onConfirmCallback = async () => {
            showSpinner();
            try {
                await actionCallback();
                showToast(successMessage, 'success');
                fetchDevicesAndStats(); 
            } catch (error) {
                showToast(errorMessage, 'danger');
            } finally {
                hideSpinner();
            }
        };

        confirmationModal.show();
    };

    // --- MANEJO DE EVENTOS ---
    elements.deviceTableBody.addEventListener('click', handleActionClick);

    // Navegación
    Object.keys(elements.navLinks).forEach(key => {
        elements.navLinks[key].addEventListener('click', (e) => {
            e.preventDefault();
            switchView(key);
        });
    });

    // Paginación
    elements.paginationControls.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.page) {
            appState.currentPage = parseInt(e.target.dataset.page, 10);
            fetchDevices();
        }
    });
    
    // Búsqueda
    elements.searchInput.addEventListener('input', () => {
        appState.searchTerm = elements.searchInput.value;
        appState.currentPage = 1;
        fetchDevices();
    });
    
    // Ordenación
    document.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        
        const newSortBy = th.dataset.sort;
        if (appState.sortBy === newSortBy) {
            appState.sortOrder = appState.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            appState.sortBy = newSortBy;
            appState.sortOrder = 'desc';
        }

        // Actualizar UI de ordenación
        document.querySelectorAll('th[data-sort] span').forEach(span => span.textContent = '');
        const arrow = appState.sortOrder === 'asc' ? '▲' : '▼';
        th.querySelector('span').textContent = ` ${arrow}`;
        
        fetchDevices();
    });

    // Selector de por página
    elements.perPageSelect.addEventListener('change', () => {
        appState.perPage = parseInt(elements.perPageSelect.value, 10);
        appState.currentPage = 1;
        fetchDevices();
    });

    // Auto-refresco
    const toggleAutoRefresh = () => {
        if (elements.autoRefreshSwitch.checked) {
            appState.autoRefreshEnabled = true;
            if (!appState.autoRefreshIntervalId) {
                appState.autoRefreshIntervalId = setInterval(fetchDevicesAndStats, 10000);
            }
        } else {
            appState.autoRefreshEnabled = false;
            clearInterval(appState.autoRefreshIntervalId);
            appState.autoRefreshIntervalId = null;
        }
    };
    elements.autoRefreshSwitch.addEventListener('change', toggleAutoRefresh);
    
    // Formulario de configuración
    elements.configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showSpinner();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        // Manejar checkbox
        data.dry_run_enabled = formData.has('dry_run_enabled');
        
        // Convertir números
        data.scan_interval_seconds = parseInt(data.scan_interval_seconds, 10);
        data.auto_release_threshold_hours = parseInt(data.auto_release_threshold_hours, 10);

        try {
            const response = await apiFetch('/api/config', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast(response.message, 'success');
            updateDryRunBanner(response.config.dry_run_enabled);
        } catch (error) {
            // Ya manejado por apiFetch
        } finally {
            hideSpinner();
        }
    });

    // Limpiar base de datos
    elements.clearDbBtn.addEventListener('click', () => {
        confirmAndExecute(
            '¡ADVERTENCIA! Esta acción es irreversible y eliminará todos los dispositivos, logs y estadísticas. La configuración y el usuario no se verán afectados. ¿Desea continuar?',
            () => apiFetch('/api/database/clear', { method: 'POST' }),
            'Base de datos limpiada correctamente.',
            'Error al limpiar la base de datos.'
        );
    });

    // Filtro de logs
    elements.logFilterSelect.addEventListener('change', () => {
        appState.logFilter = elements.logFilterSelect.value;
        fetchLogs();
    });

    // Selector de período de estadísticas
    elements.statsPeriodSelectors.forEach(button => {
        button.addEventListener('click', () => {
            elements.statsPeriodSelectors.forEach(btn => btn.classList.remove('active', 'btn-primary'));
            elements.statsPeriodSelectors.forEach(btn => btn.classList.add('btn-outline-primary'));
            
            button.classList.add('active', 'btn-primary');
            button.classList.remove('btn-outline-primary');

            appState.statsPeriod = button.dataset.period;
            fetchHistoricalStats();
        });
    });

    // --- INICIO DE LA APLICACIÓN ---
    switchView('dashboard');
    toggleAutoRefresh(); // Inicia el refresco si el switch está checked
});
