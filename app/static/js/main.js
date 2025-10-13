// app/static/js/main.js

document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURACIÓN INICIAL ---
    dayjs.extend(window.dayjs_plugin_relativeTime);
    dayjs.extend(window.dayjs_plugin_localizedFormat);
    dayjs.extend(window.dayjs_plugin_utc);
    dayjs.locale('es');

    // --- ESTADO DE LA APLICACIÓN ---
    const appState = {
        currentView: 'dashboard',
        autoRefreshInterval: null,
        autoRefreshEnabled: true,
        debounceTimer: null,
        pagination: {
            page: 1,
            per_page: 50,
            sort_by: 'last_seen',
            order: 'desc',
            search: ''
        },
        charts: {
            releases: null,
            activity: null
        }
    };

    // --- SELECTORES DE ELEMENTOS DEL DOM ---
    const elements = {
        views: {
            dashboard: document.getElementById('dashboard-view'),
            stats: document.getElementById('stats-view'),
            config: document.getElementById('config-view'),
            logs: document.getElementById('logs-view')
        },
        navLinks: {
            dashboard: document.getElementById('nav-dashboard'),
            stats: document.getElementById('nav-stats'),
            config: document.getElementById('nav-config'),
            logs: document.getElementById('nav-logs')
        },
        dashboard: {
            statsTotal: document.getElementById('stats-total-devices'),
            statsActive: document.getElementById('stats-active-devices'),
            statsReleased: document.getElementById('stats-released-ips'),
            searchInput: document.getElementById('search-input'),
            perPageSelect: document.getElementById('per-page-select'),
            tableBody: document.getElementById('devices-table-body'),
            paginationControls: document.getElementById('pagination-controls'),
            tableHeaders: document.querySelectorAll('.sortable')
        },
        stats: {
            periodSelectors: document.querySelectorAll('.period-selector'),
            releasesChartCanvas: document.getElementById('releases-chart'),
            activityChartCanvas: document.getElementById('activity-chart')
        },
        config: {
            form: document.getElementById('config-form'),
            clearDbBtn: document.getElementById('clear-database-btn'),
            dryRunBanner: document.getElementById('dry-run-banner')
        },
        logs: {
            list: document.getElementById('logs-list'),
            filter: document.getElementById('log-filter-select') // <-- NUEVO SELECTOR
        },
        general: {
            autoRefreshSwitch: document.getElementById('auto-refresh-switch'),
            spinnerOverlay: document.getElementById('spinner-overlay'),
            notificationArea: document.getElementById('notification-area'),
            confirmationModal: new bootstrap.Modal(document.getElementById('confirmationModal')),
            confirmationModalBody: document.getElementById('confirmationModalBody'),
            confirmActionButton: document.getElementById('confirmActionButton')
        }
    };

    // --- FUNCIONES CORE ---

    /**
     * Wrapper centralizado para las llamadas a la API.
     * Incluye automáticamente el token CSRF y gestiona el spinner de carga.
     * @param {string} url - El endpoint de la API.
     * @param {object} options - Opciones para la función fetch.
     * @returns {Promise<any>} - La respuesta JSON de la API.
     */
    const fetchAPI = async (url, options = {}) => {
        showSpinner();
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-CSRFToken': csrfToken
        };
        options.headers = { ...defaultHeaders, ...options.headers };

        try {
            const response = await fetch(url, options);
            if (response.status === 401) {
                // Si la sesión ha expirado, redirigir al login
                window.location.href = '/login';
                return;
            }
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Error de comunicación con el servidor.' }));
                throw new Error(errorData.error || `Error ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            showNotification(`Error: ${error.message}`, 'danger');
            throw error; // Propagar el error para que la función que llama pueda manejarlo
        } finally {
            hideSpinner();
        }
    };

    /**
     * Cambia la vista activa en la interfaz.
     * @param {string} viewName - El nombre de la vista a mostrar (dashboard, stats, config, logs).
     */
    const switchView = (viewName) => {
        appState.currentView = viewName;
        Object.values(elements.views).forEach(view => view.classList.add('d-none'));
        Object.values(elements.navLinks).forEach(link => link.classList.remove('active'));

        elements.views[viewName].classList.remove('d-none');
        elements.navLinks[viewName].classList.add('active');

        // Detener el refresco automático si no estamos en el dashboard
        if (viewName !== 'dashboard') {
            stopAutoRefresh();
        } else if (appState.autoRefreshEnabled) {
            startAutoRefresh();
        }

        // Cargar los datos de la vista seleccionada
        switch (viewName) {
            case 'dashboard':
                loadDashboardData();
                break;
            case 'stats':
                loadHistoricalStats();
                break;
            case 'config':
                loadConfigData();
                break;
            case 'logs':
                loadLogsData();
                break;
        }
    };

    // --- FUNCIONES DE CARGA DE DATOS ---
    const loadDashboardData = () => {
        fetchAPI('/api/stats').then(data => {
            elements.dashboard.statsTotal.textContent = data.total_devices;
            elements.dashboard.statsActive.textContent = data.active_devices;
            elements.dashboard.statsReleased.textContent = data.released_ips;
        });
        loadDevices();
    };
    
    const loadDevices = () => {
        const { page, per_page, sort_by, order, search } = appState.pagination;
        const url = `/api/devices?page=${page}&per_page=${per_page}&sort_by=${sort_by}&order=${order}&search=${search}`;
        fetchAPI(url).then(data => {
            renderDevices(data.items);
            renderPagination(data.pagination);
        });
    };

    const loadConfigData = () => {
        fetchAPI('/api/config').then(config => {
            renderConfig(config);
        });
    };

    // --- INICIO DE MODIFICACIÓN ---
    const loadLogsData = () => {
        const eventType = elements.logs.filter.value;
        fetchAPI(`/api/logs?limit=200&event_type=${eventType}`).then(logs => {
            renderLogs(logs);
        });
    };
    // --- FIN DE MODIFICACIÓN ---
    
    const loadHistoricalStats = (period = '7d') => {
        fetchAPI(`/api/stats/historical?period=${period}`).then(data => {
            renderStatsCharts(data);
        });
    };
    
    const loadInitialConfig = () => {
        fetchAPI('/api/config').then(config => {
            updateDryRunBanner(config.dry_run_enabled);
        });
    };

    // --- FUNCIONES DE RENDERIZADO ---
    const renderDevices = (devices) => {
        const tableBody = elements.dashboard.tableBody;
        tableBody.innerHTML = '';
        if (devices.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center">No se encontraron dispositivos.</td></tr>`;
            return;
        }

        devices.forEach(device => {
            const statusClass = device.status === 'active' ? 'bg-success' : (device.status === 'inactive' ? 'bg-warning' : 'bg-secondary');
            const row = `
                <tr>
                    <td>${device.ip_address}</td>
                    <td>${device.mac_address}</td>
                    <td>${device.vendor || 'Desconocido'}</td>
                    <td>${dayjs.utc(device.last_seen).fromNow()}</td>
                    <td><span class="badge ${statusClass}">${device.status}</span></td>
                    <td>${device.is_excluded ? 'Sí' : 'No'}</td>
                    <td>
                        <button class="btn btn-sm btn-primary release-btn" data-id="${device.id}" title="Liberar IP">Liberar</button>
                        <button class="btn btn-sm ${device.is_excluded ? 'btn-success' : 'btn-warning'} exclude-btn" data-id="${device.id}" data-excluded="${device.is_excluded}" title="${device.is_excluded ? 'Incluir en automatización' : 'Excluir de automatización'}">
                            ${device.is_excluded ? 'Incluir' : 'Excluir'}
                        </button>
                    </td>
                </tr>
            `;
            tableBody.insertAdjacentHTML('beforeend', row);
        });
    };

    const renderPagination = (pagination) => {
        const controls = elements.dashboard.paginationControls;
        controls.innerHTML = '';
        let html = '<ul class="pagination mb-0">';
        
        html += `<li class="page-item ${!pagination.has_prev ? 'disabled' : ''}">
                   <a class="page-link" href="#" data-page="${pagination.page - 1}">Anterior</a>
                 </li>`;

        const start = Math.max(1, pagination.page - 2);
        const end = Math.min(pagination.total_pages, pagination.page + 2);

        if (start > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
            if (start > 2) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }

        for (let i = start; i <= end; i++) {
            html += `<li class="page-item ${i === pagination.page ? 'active' : ''}">
                       <a class="page-link" href="#" data-page="${i}">${i}</a>
                     </li>`;
        }

        if (end < pagination.total_pages) {
            if (end < pagination.total_pages - 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${pagination.total_pages}">${pagination.total_pages}</a></li>`;
        }
        
        html += `<li class="page-item ${!pagination.has_next ? 'disabled' : ''}">
                   <a class="page-link" href="#" data-page="${pagination.page + 1}">Siguiente</a>
                 </li>`;
        html += '</ul>';
        controls.innerHTML = html;
    };
    
    const renderConfig = (config) => {
        const form = elements.config.form;
        form.scan_subnet.value = config.scan_subnet;
        form.dhcp_server_ip.value = config.dhcp_server_ip;
        form.network_interface.value = config.network_interface;
        form.auto_release_threshold_hours.value = config.auto_release_threshold_hours;
        form.mac_auto_release_list.value = config.mac_auto_release_list;
        form.dry_run_enabled.checked = config.dry_run_enabled;
    };
    
    const renderLogs = (logs) => {
        const list = elements.logs.list;
        list.innerHTML = '';
        if (logs.length === 0) {
            list.innerHTML = '<div class="list-group-item">No hay logs para el filtro seleccionado.</div>';
            return;
        }

        logs.forEach(log => {
            const levelClass = {
                'INFO': 'list-group-item-info',
                'WARNING': 'list-group-item-warning',
                'ERROR': 'list-group-item-danger'
            }[log.level] || '';
            const item = `
                <div class="list-group-item ${levelClass}">
                    <div class="d-flex w-100 justify-content-between">
                        <small class="text-muted">${dayjs(log.timestamp).format('YYYY-MM-DD HH:mm:ss')}</small>
                        <span class="badge bg-secondary">${log.level}</span>
                    </div>
                    <p class="mb-1">${log.message}</p>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', item);
        });
    };

    const renderStatsCharts = (data) => {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        };

        if (appState.charts.releases) appState.charts.releases.destroy();
        appState.charts.releases = new Chart(elements.stats.releasesChartCanvas, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: data.datasets.releases.map(ds => ({
                    ...ds,
                    backgroundColor: ds.label.includes('Inactividad') ? 'rgba(255, 159, 64, 0.5)' : 
                                     ds.label.includes('MAC') ? 'rgba(255, 99, 132, 0.5)' : 'rgba(54, 162, 235, 0.5)',
                    borderColor: ds.label.includes('Inactividad') ? 'rgba(255, 159, 64, 1)' :
                                 ds.label.includes('MAC') ? 'rgba(255, 99, 132, 1)' : 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }))
            },
            options: chartOptions
        });

        if (appState.charts.activity) appState.charts.activity.destroy();
        appState.charts.activity = new Chart(elements.stats.activityChartCanvas, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: data.datasets.activity.map(ds => ({
                    ...ds,
                    fill: false,
                    tension: 0.1,
                    borderColor: ds.label.includes('Pico') ? 'rgba(75, 192, 192, 1)' : 'rgba(153, 102, 255, 1)',
                }))
            },
            options: chartOptions
        });
    };

    const updateDryRunBanner = (isEnabled) => {
        if (isEnabled) {
            elements.config.dryRunBanner.innerHTML = `
                <div class="alert alert-warning" role="alert">
                    <strong>Modo Simulación (Dry Run) está activado.</strong> No se realizarán cambios reales en la red.
                </div>
            `;
        } else {
            elements.config.dryRunBanner.innerHTML = '';
        }
    };
    
    // --- MANEJADORES DE EVENTOS ---
    
    // Navegación
    Object.entries(elements.navLinks).forEach(([name, link]) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(name);
        });
    });

    // Dashboard: Ordenación de tabla
    elements.dashboard.tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const sortBy = header.dataset.sort;
            if (appState.pagination.sort_by === sortBy) {
                appState.pagination.order = appState.pagination.order === 'asc' ? 'desc' : 'asc';
            } else {
                appState.pagination.sort_by = sortBy;
                appState.pagination.order = 'desc';
            }
            updateSortIndicators();
            loadDevices();
        });
    });

    // Dashboard: Búsqueda
    elements.dashboard.searchInput.addEventListener('input', () => {
        clearTimeout(appState.debounceTimer);
        appState.debounceTimer = setTimeout(() => {
            appState.pagination.search = elements.dashboard.searchInput.value;
            appState.pagination.page = 1;
            loadDevices();
        }, 300);
    });
    
    // Dashboard: Paginación
    elements.dashboard.paginationControls.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.target.tagName === 'A' && e.target.dataset.page) {
            appState.pagination.page = parseInt(e.target.dataset.page, 10);
            loadDevices();
        }
    });
    
    // Dashboard: Selección de por página
    elements.dashboard.perPageSelect.addEventListener('change', () => {
        appState.pagination.per_page = parseInt(elements.dashboard.perPageSelect.value, 10);
        appState.pagination.page = 1;
        loadDevices();
    });

    // Dashboard: Botones de acción en la tabla
    elements.dashboard.tableBody.addEventListener('click', (e) => {
        const target = e.target;
        const deviceId = target.dataset.id;
        if (!deviceId) return;

        if (target.classList.contains('release-btn')) {
            showConfirmationModal('¿Estás seguro de que quieres liberar la IP de este dispositivo?', () => {
                fetchAPI(`/api/devices/${deviceId}/release`, { method: 'POST' })
                    .then(data => {
                        showNotification(data.message, 'success');
                        loadDashboardData();
                    });
            });
        } else if (target.classList.contains('exclude-btn')) {
            const isExcluded = target.dataset.excluded === 'true';
            const actionText = isExcluded ? 'incluir este dispositivo en las reglas automáticas' : 'excluir este dispositivo de las reglas automáticas';
            showConfirmationModal(`¿Estás seguro de que quieres ${actionText}?`, () => {
                fetchAPI(`/api/devices/${deviceId}/exclude`, {
                    method: 'PUT',
                    body: JSON.stringify({ is_excluded: !isExcluded })
                }).then(data => {
                    showNotification(data.message, 'success');
                    loadDevices();
                });
            });
        }
    });
    
    // Stats: Selector de período
    elements.stats.periodSelectors.forEach(button => {
        button.addEventListener('click', () => {
            elements.stats.periodSelectors.forEach(btn => btn.classList.remove('btn-primary', 'active'));
            elements.stats.periodSelectors.forEach(btn => btn.classList.add('btn-outline-primary'));
            button.classList.add('btn-primary', 'active');
            button.classList.remove('btn-outline-primary');
            loadHistoricalStats(button.dataset.period);
        });
    });

    // Config: Guardar formulario
    elements.config.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(elements.config.form);
        const data = Object.fromEntries(formData.entries());
        data.auto_release_threshold_hours = parseInt(data.auto_release_threshold_hours, 10);
        data.dry_run_enabled = elements.config.form.dry_run_enabled.checked;

        fetchAPI('/api/config', {
            method: 'PUT',
            body: JSON.stringify(data)
        }).then(response => {
            showNotification(response.message, 'success');
            updateDryRunBanner(response.config.dry_run_enabled);
        });
    });
    
    // Config: Limpiar base de datos
    elements.config.clearDbBtn.addEventListener('click', () => {
        showConfirmationModal('¡ACCIÓN DESTRUCTIVA! ¿Estás seguro de que quieres eliminar TODOS los dispositivos, logs y estadísticas?', () => {
            fetchAPI('/api/database/clear', { method: 'POST' })
                .then(data => {
                    showNotification(data.message, 'success');
                    if (appState.currentView === 'dashboard') loadDashboardData();
                    if (appState.currentView === 'logs') loadLogsData();
                    if (appState.currentView === 'stats') loadHistoricalStats();
                });
        });
    });

    // --- NUEVO EVENT LISTENER para el filtro de logs ---
    elements.logs.filter.addEventListener('change', () => {
        loadLogsData();
    });
    
    // General: Auto-refresco
    elements.general.autoRefreshSwitch.addEventListener('change', (e) => {
        appState.autoRefreshEnabled = e.target.checked;
        if (appState.autoRefreshEnabled && appState.currentView === 'dashboard') {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });

    // --- FUNCIONES DE UTILIDAD ---
    const showSpinner = () => elements.general.spinnerOverlay.classList.remove('d-none');
    const hideSpinner = () => elements.general.spinnerOverlay.classList.add('d-none');

    const showNotification = (message, type = 'info') => {
        const toastId = `toast-${Date.now()}`;
        const toastHTML = `
            <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header">
                    <strong class="me-auto text-${type}">Notificación</strong>
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">${message}</div>
            </div>
        `;
        elements.general.notificationArea.insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
        toast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    };

    const showConfirmationModal = (message, onConfirm) => {
        elements.general.confirmationModalBody.textContent = message;
        
        const newConfirmButton = elements.general.confirmActionButton.cloneNode(true);
        elements.general.confirmActionButton.parentNode.replaceChild(newConfirmButton, elements.general.confirmActionButton);
        elements.general.confirmActionButton = newConfirmButton;

        elements.general.confirmActionButton.addEventListener('click', () => {
            onConfirm();
            elements.general.confirmationModal.hide();
        }, { once: true });
        
        elements.general.confirmationModal.show();
    };

    const updateSortIndicators = () => {
        elements.dashboard.tableHeaders.forEach(header => {
            const span = header.querySelector('span');
            if (header.dataset.sort === appState.pagination.sort_by) {
                span.textContent = appState.pagination.order === 'asc' ? ' ▲' : ' ▼';
            } else {
                span.textContent = '';
            }
        });
    };

    const startAutoRefresh = () => {
        if (appState.autoRefreshInterval) clearInterval(appState.autoRefreshInterval);
        appState.autoRefreshInterval = setInterval(loadDashboardData, 10000); // 10 segundos
    };

    const stopAutoRefresh = () => {
        clearInterval(appState.autoRefreshInterval);
        appState.autoRefreshInterval = null;
    };
    
    // --- INICIALIZACIÓN ---
    const init = () => {
        loadInitialConfig();
        switchView('dashboard');
        updateSortIndicators();
    };

    init();
});
