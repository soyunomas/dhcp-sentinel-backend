// app/static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- ESTADO DE LA APLICACIÓN ---
    let appState = {
        sortBy: 'last_seen',
        order: 'desc',
        searchTerm: '',
        currentPage: 1,
        perPage: 50
    };
    let autoRefreshInterval = null;
    const REFRESH_INTERVAL_MS = 10000;

    // --- ELEMENTOS DEL DOM ---
    const views = {
        dashboard: document.getElementById('dashboard-view'),
        config: document.getElementById('config-view'),
        logs: document.getElementById('logs-view'),
    };
    const navLinks = {
        dashboard: document.getElementById('nav-dashboard'),
        config: document.getElementById('nav-config'),
        logs: document.getElementById('nav-logs'),
    };
    const tableBody = document.getElementById('devices-table-body');
    const searchInput = document.getElementById('search-input');
    const spinnerOverlay = document.getElementById('spinner-overlay');
    const autoRefreshSwitch = document.getElementById('auto-refresh-switch');
    const confirmationModalEl = document.getElementById('confirmationModal');
    const confirmationModal = new bootstrap.Modal(confirmationModalEl);
    const perPageSelect = document.getElementById('per-page-select');
    const paginationControls = document.getElementById('pagination-controls');

    // --- CONFIGURACIÓN DE DAY.JS PARA ESPAÑOL ---
    dayjs.extend(dayjs_plugin_relativeTime);
    dayjs.extend(dayjs_plugin_localizedFormat);
    dayjs.extend(dayjs_plugin_utc); // <-- 1. ACTIVAR EL PLUGIN UTC
    dayjs.locale('es');

    // --- FUNCIONES DE UTILIDAD ---
    const showSpinner = () => spinnerOverlay.classList.remove('d-none');
    const hideSpinner = () => spinnerOverlay.classList.add('d-none');
    
    const showNotification = (message, type = 'success') => {
        const toastId = `toast-${Date.now()}`;
        const toastHTML = `
            <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;
        document.getElementById('notification-area').insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    };

    const showConfirmationModal = (message, onConfirm) => {
        const modalBody = confirmationModalEl.querySelector('#confirmationModalBody');
        const confirmButton = confirmationModalEl.querySelector('#confirmActionButton');
        modalBody.textContent = message;
        const newConfirmButton = confirmButton.cloneNode(true);
        confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
        newConfirmButton.addEventListener('click', () => {
            onConfirm();
            confirmationModal.hide();
        });
        confirmationModal.show();
    };

    const formatRelativeTime = (isoTimestamp) => {
        const now = dayjs.utc(); // <-- 2. USAR UTC PARA LA HORA ACTUAL
        const then = dayjs(isoTimestamp); // dayjs interpreta la 'Z' o el offset como UTC por defecto
        
        const diffMinutes = now.diff(then, 'minute');
        const diffHours = now.diff(then, 'hour');

        if (diffMinutes < 1) return 'hace unos segundos';
        if (diffMinutes < 60) return `hace ${diffMinutes} minuto${diffMinutes > 1 ? 's' : ''}`;
        if (diffHours < 24) {
            const minutes = diffMinutes % 60;
            let result = `hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
            if (minutes > 0) result += ` y ${minutes} minuto${minutes > 1 ? 's' : ''}`;
            return result;
        }
        return then.fromNow();
    };

    // --- LÓGICA DE NAVEGACIÓN ---
    const switchView = (targetView) => {
        Object.values(views).forEach(view => view.classList.add('d-none'));
        Object.values(navLinks).forEach(link => link.classList.remove('active'));
        views[targetView].classList.remove('d-none');
        navLinks[targetView].classList.add('active');
    };

    Object.keys(navLinks).forEach(key => {
        navLinks[key].addEventListener('click', (e) => {
            e.preventDefault();
            switchView(key);
            if (key === 'dashboard') fetchAndRenderAll();
            else if (key === 'config') fetchAndRenderConfig();
            else if (key === 'logs') fetchLogs();
        });
    });

    // --- LÓGICA DE FETCH (API) ---
    const fetchData = async (url) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Fetch error:', error);
            showNotification(`Error de red: ${error.message}`, 'danger');
            throw error;
        }
    };
    
    // --- LÓGICA DE RENDERIZADO ---
    const updateStats = async () => {
        try {
            const stats = await fetchData('/api/stats');
            document.getElementById('stats-total-devices').textContent = stats.total_devices;
            document.getElementById('stats-active-devices').textContent = stats.active_devices;
            document.getElementById('stats-released-ips').textContent = stats.released_ips;
        } catch (error) {
            console.error('Error al cargar estadísticas:', error);
        }
    };
    
    const renderPaginationControls = (pagination) => {
        paginationControls.innerHTML = '';
        if (pagination.total_pages <= 1) return;

        let html = '<nav><ul class="pagination mb-0">';
        
        html += `<li class="page-item ${pagination.has_prev ? '' : 'disabled'}"><a class="page-link" href="#" data-page="${pagination.page - 1}">Anterior</a></li>`;

        for (let i = 1; i <= pagination.total_pages; i++) {
            if (i === pagination.page) {
                html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
            } else {
                html += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
            }
        }
        
        html += `<li class="page-item ${pagination.has_next ? '' : 'disabled'}"><a class="page-link" href="#" data-page="${pagination.page + 1}">Siguiente</a></li>`;
        
        html += '</ul></nav>';
        paginationControls.innerHTML = html;
    };

    const renderDevicesTable = async () => {
        try {
            const url = `/api/devices?sort_by=${appState.sortBy}&order=${appState.order}&search=${appState.searchTerm}&page=${appState.currentPage}&per_page=${appState.perPage}`;
            const data = await fetchData(url);
            const devices = data.items;
            tableBody.innerHTML = '';
            
            if (devices.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No se encontraron dispositivos.</td></tr>';
                paginationControls.innerHTML = '';
                return;
            }

            devices.forEach(device => {
                const lastSeen = formatRelativeTime(device.last_seen);
                const statusBadge = device.status === 'active' ? 'bg-success' : 'bg-secondary';
                const excludedBadge = device.is_excluded ? '<span class="badge bg-primary">Sí</span>' : '<span class="badge bg-secondary">No</span>';
                const row = `<tr>
                        <td>${device.ip_address}</td>
                        <td>${device.mac_address}</td>
                        <td>${device.vendor}</td>
                        <td title="${dayjs(device.last_seen).format('llll')}">${lastSeen}</td>
                        <td><span class="badge ${statusBadge}">${device.status}</span></td>
                        <td>${excludedBadge}</td>
                        <td>
                            <button class="btn btn-warning btn-sm release-btn" data-device-id="${device.id}" title="Liberar IP">Liberar</button>
                            <button class="btn btn-info btn-sm exclude-btn" data-device-id="${device.id}" data-is-excluded="${device.is_excluded}" title="Excluir de acciones automáticas">${device.is_excluded ? 'Incluir' : 'Excluir'}</button>
                        </td>
                    </tr>`;
                tableBody.insertAdjacentHTML('beforeend', row);
            });

            renderPaginationControls(data.pagination);

        } catch (error) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar los dispositivos.</td></tr>';
        }
    };

    const fetchAndRenderAll = (showSpinnerFlag = false) => {
        if (showSpinnerFlag) showSpinner();
        Promise.all([updateStats(), renderDevicesTable()])
            .catch(error => console.error("Error al refrescar el dashboard", error))
            .finally(() => {
                if(showSpinnerFlag) hideSpinner();
            });
    };

    const updateDryRunBanner = (isEnabled) => {
        const banner = document.getElementById('dry-run-banner');
        if (isEnabled) banner.innerHTML = `<div class="alert alert-warning" role="alert"><strong>Modo Simulación (Dry Run) está ACTIVO.</strong> Las acciones de liberación de IP no se ejecutarán realmente, solo se registrarán en los logs.</div>`;
        else banner.innerHTML = `<div class="alert alert-danger" role="alert"><strong>Modo Simulación (Dry Run) está DESACTIVADO.</strong> Las acciones de liberación son reales.</div>`;
    };

    const fetchAndRenderConfig = async () => {
        showSpinner();
        try {
            const config = await fetchData('/api/config');
            document.getElementById('dry_run_enabled').checked = config.dry_run_enabled;
            document.getElementById('scan_subnet').value = config.scan_subnet;
            document.getElementById('dhcp_server_ip').value = config.dhcp_server_ip;
            document.getElementById('network_interface').value = config.network_interface;
            document.getElementById('auto_release_threshold_hours').value = config.auto_release_threshold_hours;
            document.getElementById('mac_auto_release_list').value = config.mac_auto_release_list;
            updateDryRunBanner(config.dry_run_enabled);
        } catch (error) {
            showNotification('Error al cargar la configuración.', 'danger');
        } finally {
            hideSpinner();
        }
    };

    const fetchLogs = async () => {
        showSpinner();
        try {
            const logs = await fetchData('/api/logs?limit=200');
            const logsList = document.getElementById('logs-list');
            logsList.innerHTML = '';
            logs.forEach(log => {
                let levelClass = 'list-group-item-secondary';
                if (log.level === 'INFO') levelClass = 'list-group-item-light';
                if (log.level === 'WARNING') levelClass = 'list-group-item-warning';
                if (log.level === 'ERROR') levelClass = 'list-group-item-danger';

                const logItem = `<div class="list-group-item ${levelClass}"><div class="d-flex w-100 justify-content-between"><small class="mb-1"><strong>${log.level}</strong></small><small>${dayjs(log.timestamp).format('YYYY-MM-DD HH:mm:ss')}</small></div><p class="mb-1 small">${log.message}</p></div>`;
                logsList.insertAdjacentHTML('beforeend', logItem);
            });
        } catch (error) {
            showNotification('Error al cargar los logs.', 'danger');
        } finally {
            hideSpinner();
        }
    };

    // --- MANEJADORES DE ACCIONES ---
    const releaseDeviceIp = async (deviceId) => {
        showSpinner();
        try {
            const response = await fetch(`/api/devices/${deviceId}/release`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showNotification(result.message, 'success');
            fetchAndRenderAll();
        } catch (error) {
            showNotification(`Error al liberar IP: ${error.message}`, 'danger');
        } finally {
            hideSpinner();
        }
    };

    const toggleDeviceExclusion = async (deviceId, newExcludeState) => {
        showSpinner();
        try {
            const response = await fetch(`/api/devices/${deviceId}/exclude`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_excluded: newExcludeState }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showNotification(result.message, 'success');
            fetchAndRenderAll();
        } catch (error) {
            showNotification(`Error al cambiar exclusión: ${error.message}`, 'danger');
        } finally {
            hideSpinner();
        }
    };
    
    const clearDatabase = async () => {
        showSpinner();
        try {
            const response = await fetch(`/api/database/clear`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showNotification(result.message, 'warning');
            appState.currentPage = 1;
            fetchAndRenderAll();
            fetchLogs();
        } catch (error) {
            showNotification(`Error al limpiar la base de datos: ${error.message}`, 'danger');
        } finally {
            hideSpinner();
        }
    };

    // --- EVENT LISTENERS ---
    searchInput.addEventListener('input', () => {
        appState.searchTerm = searchInput.value.trim();
        appState.currentPage = 1;
        renderDevicesTable();
    });

    document.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('.sortable');
        if (th) {
            const sortBy = th.dataset.sort;
            if (appState.sortBy === sortBy) {
                appState.order = appState.order === 'asc' ? 'desc' : 'asc';
            } else {
                appState.sortBy = sortBy;
                appState.order = 'desc';
            }
            appState.currentPage = 1;
            renderDevicesTable();
        }
    });

    tableBody.addEventListener('click', (e) => {
        const target = e.target;
        const deviceId = target.dataset.deviceId;
        if (target.classList.contains('release-btn')) {
            showConfirmationModal(`¿Estás seguro de que quieres enviar una solicitud DHCPRELEASE para este dispositivo?`, () => releaseDeviceIp(deviceId));
        } else if (target.classList.contains('exclude-btn')) {
            const isExcluded = target.dataset.isExcluded === 'true';
            const actionText = isExcluded ? 'incluir en' : 'excluir de';
            showConfirmationModal(`¿Estás seguro de que quieres ${actionText} las acciones automáticas para este dispositivo?`, () => toggleDeviceExclusion(deviceId, !isExcluded));
        }
    });

    document.getElementById('config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showSpinner();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.auto_release_threshold_hours = parseInt(data.auto_release_threshold_hours, 10);
        data.dry_run_enabled = document.getElementById('dry_run_enabled').checked;

        try {
            const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showNotification(result.message, 'success');
            updateDryRunBanner(result.config.dry_run_enabled);
        } catch (error) {
            showNotification(`Error al guardar configuración: ${error.message}`, 'danger');
        } finally {
            hideSpinner();
        }
    });
    
    document.getElementById('clear-database-btn').addEventListener('click', () => {
        showConfirmationModal('¡ADVERTENCIA! Esta acción eliminará permanentemente todos los dispositivos y logs. ¿Estás seguro?', clearDatabase);
    });

    autoRefreshSwitch.addEventListener('change', () => {
        if (autoRefreshSwitch.checked) {
            if (!autoRefreshInterval) autoRefreshInterval = setInterval(fetchAndRenderAll, REFRESH_INTERVAL_MS);
        } else {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        }
    });

    perPageSelect.addEventListener('change', () => {
        appState.perPage = parseInt(perPageSelect.value, 10);
        appState.currentPage = 1;
        renderDevicesTable();
    });

    paginationControls.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.target;
        if (target.tagName === 'A' && target.dataset.page) {
            appState.currentPage = parseInt(target.dataset.page, 10);
            renderDevicesTable();
        }
    });
    
    // --- INICIALIZACIÓN ---
    const init = () => {
        perPageSelect.value = appState.perPage;
        fetchAndRenderConfig();
        fetchAndRenderAll(true);
        if (autoRefreshSwitch.checked) {
            autoRefreshInterval = setInterval(fetchAndRenderAll, REFRESH_INTERVAL_MS);
        }
    };
    
    init();
});
