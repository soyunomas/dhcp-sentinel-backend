document.addEventListener('DOMContentLoaded', () => {

    // --- Configuración de Day.js ---
    dayjs.extend(dayjs_plugin_relativeTime);
    dayjs.extend(dayjs_plugin_localizedFormat);
    dayjs.locale('es');

    // --- Selectores de Elementos ---
    const dashboardView = document.getElementById('dashboard-view');
    const configView = document.getElementById('config-view');
    const logsView = document.getElementById('logs-view');
    const navLinks = {
        dashboard: document.getElementById('nav-dashboard'),
        config: document.getElementById('nav-config'),
        logs: document.getElementById('nav-logs'),
    };
    const devicesTableBody = document.getElementById('devices-table-body');
    const searchInput = document.getElementById('search-input');
    const sortableHeaders = document.querySelectorAll('.sortable');
    const spinner = document.getElementById('spinner-overlay');

    const confirmationModalElement = document.getElementById('confirmationModal');
    const confirmationModal = new bootstrap.Modal(confirmationModalElement);
    const confirmationModalBody = document.getElementById('confirmationModalBody');
    const confirmActionButton = document.getElementById('confirmActionButton');

    const statsTotalDevices = document.getElementById('stats-total-devices');
    const statsActiveDevices = document.getElementById('stats-active-devices');
    const statsReleasedIps = document.getElementById('stats-released-ips');

    // --- Estado de la UI ---
    let currentSortBy = 'last_seen';
    let currentOrder = 'desc';
    let currentSearchTerm = '';
    let debounceTimer;

    // --- Funciones de Renderizado y Peticiones ---

    const showSpinner = (visible) => {
        spinner.classList.toggle('d-none', !visible);
    };

    /**
     * Formatea una fecha ISO a un formato absoluto y legible (para tooltips y logs).
     */
    const formatDateTime = (isoString) => {
        if (!isoString) return 'N/A';
        return dayjs(isoString).format('DD/MM/YYYY HH:mm:ss');
    };
    
    /**
     * Pide las estadísticas a la API y las renderiza en las tarjetas.
     */
    const fetchAndRenderStats = async () => {
        try {
            const response = await fetch('/api/stats');
            if (!response.ok) throw new Error('Error al cargar estadísticas');
            const stats = await response.json();

            statsTotalDevices.textContent = stats.total_devices;
            statsActiveDevices.textContent = stats.active_devices;
            statsReleasedIps.textContent = stats.released_ips;

        } catch (error) {
            console.error(error);
            statsTotalDevices.textContent = 'N/A';
            statsActiveDevices.textContent = 'N/A';
            statsReleasedIps.textContent = 'N/A';
        }
    };

    const fetchAndRenderDevices = async () => {
        showSpinner(true);
        try {
            const url = `/api/devices?sort_by=${currentSortBy}&order=${currentOrder}&search=${encodeURIComponent(currentSearchTerm)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Error al cargar los dispositivos');
            
            const devices = await response.json();
            renderDevicesTable(devices);
            updateSortIcons();

        } catch (error) {
            console.error(error);
            devicesTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error: ${error.message}</td></tr>`;
        } finally {
            showSpinner(false);
        }
    };

    /**
     * Renderiza las filas de la tabla de dispositivos con la fecha relativa.
     */
    const renderDevicesTable = (devices) => {
        devicesTableBody.innerHTML = '';
        if (devices.length === 0) {
            devicesTableBody.innerHTML = `<tr><td colspan="7" class="text-center">No se encontraron dispositivos.</td></tr>`;
            return;
        }

        devices.forEach(device => {
            const row = document.createElement('tr');
            // --- LÍNEA MODIFICADA ---
            // Ahora la columna 'last_seen' muestra el tiempo relativo y tiene un tooltip con la fecha exacta.
            row.innerHTML = `
                <td>${device.ip_address}</td>
                <td>${device.mac_address}</td>
                <td>${device.vendor || 'Desconocido'}</td>
                <td title="${formatDateTime(device.last_seen)}">${dayjs(device.last_seen).fromNow()}</td>
                <td><span class="badge bg-${device.status === 'active' ? 'success' : 'secondary'}">${device.status}</span></td>
                <td>
                    <div class="form-check form-switch">
                        <input class="form-check-input btn-exclude" type="checkbox" role="switch" 
                               data-device-id="${device.id}" ${device.is_excluded ? 'checked' : ''}>
                    </div>
                </td>
                <td>
                    <button class="btn btn-warning btn-sm btn-release" data-device-id="${device.id}"
                            title="Liberar IP" ${device.status === 'released' ? 'disabled' : ''}>
                        Liberar
                    </button>
                </td>
            `;
            devicesTableBody.appendChild(row);
        });
    };

    const updateSortIcons = () => {
        sortableHeaders.forEach(header => {
            const span = header.querySelector('span');
            const sortKey = header.getAttribute('data-sort');
            if (sortKey === currentSortBy) {
                span.textContent = currentOrder === 'asc' ? ' ▲' : ' ▼';
            } else {
                span.textContent = '';
            }
        });
    };

    const configForm = document.getElementById('config-form');
    const configStatus = document.getElementById('config-status');

    const loadConfig = async () => {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            Object.keys(config).forEach(key => {
                const input = document.getElementById(key);
                if (input) input.value = config[key];
            });
        } catch (error) {
            configStatus.innerHTML = `<div class="alert alert-danger">Error al cargar la configuración.</div>`;
        }
    };

    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(configForm);
        const data = Object.fromEntries(formData.entries());
        data.auto_release_threshold_hours = parseInt(data.auto_release_threshold_hours, 10);

        try {
            const response = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await response.json();
            if (response.ok) {
                configStatus.innerHTML = `<div class="alert alert-success">${result.message}</div>`;
            } else {
                throw new Error(result.error || 'Error desconocido');
            }
        } catch (error) {
            configStatus.innerHTML = `<div class="alert alert-danger">Error al guardar: ${error.message}</div>`;
        }
    });

    const logsList = document.getElementById('logs-list');
    
    const loadLogs = async () => {
        try {
            const response = await fetch('/api/logs?limit=200');
            const logs = await response.json();
            logsList.innerHTML = logs.map(log => `
                <div class="list-group-item list-group-item-action">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1 text-${log.level === 'ERROR' ? 'danger' : (log.level === 'WARNING' ? 'warning' : 'info')}">${log.level}</h6>
                        <small>${formatDateTime(log.timestamp)}</small>
                    </div>
                    <p class="mb-1 small">${log.message}</p>
                </div>
            `).join('');
        } catch (error) {
            logsList.innerHTML = `<div class="alert alert-danger">Error al cargar los logs.</div>`;
        }
    };

    const switchView = (targetView) => {
        [dashboardView, configView, logsView].forEach(view => view.classList.add('d-none'));
        Object.values(navLinks).forEach(link => link.classList.remove('active'));

        if (targetView === 'dashboard') {
            dashboardView.classList.remove('d-none');
            navLinks.dashboard.classList.add('active');
            fetchAndRenderStats();
            fetchAndRenderDevices();
        } else if (targetView === 'config') {
            configView.classList.remove('d-none');
            navLinks.config.classList.add('active');
            loadConfig();
        } else if (targetView === 'logs') {
            logsView.classList.remove('d-none');
            navLinks.logs.classList.add('active');
            loadLogs();
        }
    };

    navLinks.dashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
    navLinks.config.addEventListener('click', (e) => { e.preventDefault(); switchView('config'); });
    navLinks.logs.addEventListener('click', (e) => { e.preventDefault(); switchView('logs'); });

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        currentSearchTerm = e.target.value;
        debounceTimer = setTimeout(() => {
            fetchAndRenderDevices();
        }, 300);
    });

    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const newSortBy = header.getAttribute('data-sort');
            if (currentSortBy === newSortBy) {
                currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortBy = newSortBy;
                currentOrder = 'desc';
            }
            fetchAndRenderDevices();
        });
    });

    devicesTableBody.addEventListener('click', async (e) => {
        const target = e.target;
        const deviceId = target.dataset.deviceId;
        if (!deviceId) return;

        if (target.classList.contains('btn-release')) {
            const row = target.closest('tr');
            const ipAddress = row.cells[0].textContent;
            const macAddress = row.cells[1].textContent;
            
            confirmationModalBody.innerHTML = `¿Estás seguro de que quieres liberar la IP <strong>${ipAddress}</strong> asignada a la MAC <strong>${macAddress}</strong>?`;
            
            confirmActionButton.onclick = () => {
                performReleaseDevice(deviceId);
            };

            confirmationModal.show();
        }
        
        if (target.classList.contains('btn-exclude')) {
            const isExcluded = target.checked;
            showSpinner(true);
            try {
                const response = await fetch(`/api/devices/${deviceId}/exclude`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_excluded: isExcluded }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                fetchAndRenderDevices();
                fetchAndRenderStats();
            } catch (error) {
                alert(`Error al cambiar estado de exclusión: ${error.message}`);
                target.checked = !isExcluded;
            } finally {
                showSpinner(false);
            }
        }
    });

    const performReleaseDevice = async (deviceId) => {
        confirmationModal.hide();
        showSpinner(true);
        try {
            const response = await fetch(`/api/devices/${deviceId}/release`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            fetchAndRenderDevices();
            fetchAndRenderStats();
        } catch (error) {
            alert(`Error al liberar IP: ${error.message}`);
        } finally {
            showSpinner(false);
        }
    };

    switchView('dashboard');
});
