/**
 * GPU Card creation and update functions
 * GPU Studio — Swiss Minimalist Edition
 */

// Helper: format memory values
function finiteCollectorNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return NaN;
    if (typeof value === 'string' && value.trim() === '') return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function formatMemory(mb) {
    const value = finiteCollectorNumber(mb);
    if (!Number.isFinite(value)) return 'Not reported';
    if (value >= 1024) {
        return `${(value / 1024).toFixed(1)}`;
    }
    return `${Math.round(value)}`;
}

// Helper: memory unit
function formatMemoryUnit(mb) {
    const value = finiteCollectorNumber(mb);
    if (!Number.isFinite(value)) return '';
    return value >= 1024 ? 'GB' : 'MB';
}

// Helper: format energy values
function formatEnergy(wh) {
    const value = finiteCollectorNumber(wh);
    if (!Number.isFinite(value)) return 'Not reported';
    if (value >= 1000) {
        return `${(value / 1000).toFixed(2)}kWh`;
    }
    return `${value.toFixed(2)}Wh`;
}

// Helper: safely get metric value with default
function getMetricValue(gpuInfo, key, defaultValue = 0) {
    if (!(key in gpuInfo) || gpuInfo[key] === null || gpuInfo[key] === undefined) return defaultValue;
    if (typeof defaultValue !== 'number' && defaultValue !== null) return gpuInfo[key];
    const value = finiteCollectorNumber(gpuInfo[key]);
    return Number.isFinite(value) ? value : defaultValue;
}

// Helper: check if metric is available
function hasMetric(gpuInfo, key) {
    const value = gpuInfo[key];
    return value !== null && value !== undefined && value !== 'N/A' && value !== 'Unknown' && value !== '';
}

function reportedNumber(value, fallback = 'Not reported') {
    const number = finiteCollectorNumber(value);
    return Number.isFinite(number) ? String(number) : fallback;
}

// Helper: tachometer reading for the fan cell, when a fan controller reports one.
// Passive cards have no fan of their own, so this comes from the external fan
// mapping rather than the GPU driver, and is absent whenever it is not configured.
function formatFanRpm(gpuInfo) {
    return hasMetric(gpuInfo, 'fan_rpm') ? `${Math.round(gpuInfo.fan_rpm)} RPM` : '';
}

// Helper: show or hide a fan cell's tachometer sub-value
function setFanRpm(elementId, gpuInfo) {
    const element = document.getElementById(elementId);
    if (!element) return;
    const text = formatFanRpm(gpuInfo);
    element.textContent = text;
    element.hidden = !text;
}

const OVERVIEW_EXTRA_METRIC_DEFINITIONS = Object.freeze([
    { id: 'fan-speed', label: 'FAN', value: gpu => formatOverviewNumber(gpu.fan_speed, '%') },
    { id: 'graphics-clock', label: 'GRAPHICS CLOCK', value: gpu => formatOverviewNumber(gpu.clock_graphics, ' MHz') },
    { id: 'memory-clock', label: 'MEMORY CLOCK', value: gpu => formatOverviewNumber(gpu.clock_memory, ' MHz') },
    { id: 'memory-used', label: 'MEMORY USED', value: gpu => formatOverviewMemoryGb(gpu.memory_used) },
    { id: 'power-limit', label: 'POWER LIMIT', value: gpu => formatOverviewNumber(gpu.power_limit, ' W') },
    { id: 'memory-temperature', label: 'MEMORY TEMP', value: gpu => formatOverviewNumber(gpu.temperature_memory, ' C') },
    { id: 'throttle-status', label: 'THROTTLE', value: gpu => window.GPUHotThrottle.status(gpu.throttle_reasons, gpu.vendor).display },
    { id: 'process-count', label: 'PROCESSES', value: (gpu, context) => formatOverviewCount(context.processCount) },
    { id: 'pcie-generation', label: 'PCIE GEN', value: gpu => formatOverviewNumber(gpu.pcie_gen, '', 'Gen ') },
    { id: 'pcie-width', label: 'PCIE WIDTH', value: gpu => formatOverviewNumber(gpu.pcie_width, '', 'x') },
    { id: 'encoder-load', label: 'ENCODER', value: gpu => formatOverviewNumber(gpu.encoder_utilization, '%') },
    { id: 'decoder-load', label: 'DECODER', value: gpu => formatOverviewNumber(gpu.decoder_utilization, '%') },
    { id: 'performance-state', label: 'PERFORMANCE', value: gpu => formatOverviewText(gpu.performance_state) }
]);
const latestOverviewExtraMetrics = new Map();

function formatOverviewNumber(value, suffix = '', prefix = '') {
    const number = finiteCollectorNumber(value);
    if (!Number.isFinite(number)) return 'Not reported';
    return `${prefix}${Math.round(number)}${suffix}`;
}

function formatOverviewMemoryGb(value) {
    const number = finiteCollectorNumber(value);
    if (!Number.isFinite(number)) return 'Not reported';
    return `${(number / 1024).toFixed(1)} GB`;
}

function formatOverviewCount(value) {
    return Number.isInteger(value) && value >= 0 ? String(value) : 'Not reported';
}

function formatOverviewText(value) {
    if (Array.isArray(value)) {
        if (!value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) {
            return 'Not reported';
        }
        value = value.join(', ');
    }
    if (value === null || value === undefined || value === '' || value === 'N/A') {
        return 'Not reported';
    }
    if (typeof value === 'object') return 'Not reported';
    return String(value).slice(0, 80);
}

function overviewExtraMetricsMarkup(gpuId) {
    return OVERVIEW_EXTRA_METRIC_DEFINITIONS.map(metric => {
        const visible = window.GPUHotSettings?.isOverviewMetricVisible?.(metric.id) === true;
        return `
                <div class="overview-metric" data-overview-metric="${metric.id}" data-overview-extra="${metric.id}"${visible ? '' : ' hidden'}>
                    <div class="overview-metric-value" id="overview-extra-${metric.id}-${gpuId}">Not reported</div>
                    <div class="overview-metric-label">${metric.label}</div>
                </div>`;
    }).join('');
}

function updateOverviewExtraMetrics(root, gpuId, gpuInfo, context = {}) {
    let updated = false;
    OVERVIEW_EXTRA_METRIC_DEFINITIONS.forEach(metric => {
        if (window.GPUHotSettings?.isOverviewMetricVisible?.(metric.id) !== true) return;
        const cell = root.nodeType === 9
            ? root.getElementById(`overview-extra-${metric.id}-${gpuId}`)?.closest('[data-overview-extra]')
            : root.querySelector(`[data-overview-extra="${metric.id}"]`);
        if (!cell) return;
        const element = cell.querySelector('.overview-metric-value');
        if (element) {
            element.textContent = metric.value(gpuInfo, context);
            updated = true;
        }
    });
    if (updated) window.GPUHotSettings?.scheduleOverviewBehindMasks?.();
}

function rememberOverviewExtraMetrics(gpuId, gpuInfo, context = {}) {
    latestOverviewExtraMetrics.set(String(gpuId), { gpuInfo, context });
}

function refreshVisibleOverviewExtraMetrics(root = document) {
    latestOverviewExtraMetrics.forEach(({ gpuInfo, context }, gpuId) => {
        updateOverviewExtraMetrics(root, gpuId, gpuInfo, context);
    });
}

function gpuCardElementFromMarkup(markupFactory, gpuId, gpuInfo, context = {}) {
    const placeholder = '__gpu_hot_identity__';
    const template = document.createElement('template');
    template.innerHTML = markupFactory(placeholder, { ...gpuInfo, name: '' }, context).trim();
    const card = template.content.firstElementChild;
    const identityElements = [card, ...card.querySelectorAll('[id], [data-gpu-id]')];
    identityElements.forEach(element => {
        if (element.id) element.id = element.id.split(placeholder).join(String(gpuId));
        if (element.dataset.gpuId === placeholder) element.dataset.gpuId = String(gpuId);
    });
    const title = card.querySelector('.gpu-detail-title, .overview-gpu-name h2');
    if (title) title.textContent = `GPU ${gpuId}`;
    const model = card.querySelector('.gpu-detail-name, .overview-gpu-name p');
    if (model) model.textContent = String(gpuInfo.name || 'Unknown');
    rememberOverviewExtraMetrics(gpuId, gpuInfo, context);
    updateOverviewExtraMetrics(card, gpuId, gpuInfo, context);
    card.removeAttribute('onclick');
    return card;
}

function renderCollectorText(markup, collectorValues) {
    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    template.content.querySelectorAll('[data-collector-text]').forEach(element => {
        const field = element.dataset.collectorText;
        const text = String(collectorValues[field] ?? '');
        element.textContent = text;
        if (element.hasAttribute('data-collector-title')) element.title = text;
        element.removeAttribute('data-collector-text');
        element.removeAttribute('data-collector-title');
    });
    return template.innerHTML;
}

// Helper: bullet bar CSS class based on thresholds
function bulletClass(value, warnThreshold, dangerThreshold) {
    if (value >= dangerThreshold) return 'danger';
    if (value >= warnThreshold) return 'warning';
    return '';
}

// Aggregate VRAM summary card (shown when 2+ GPUs)
function createAggregateCard() {
    return `
        <div id="aggregate-card" class="agg-vram-wrap">
            <div class="agg-vram-inner">
                <div class="agg-vram-row">
                    <span class="node-label">Total VRAM</span>
                    <span class="agg-vram-value" id="agg-vram-value">0 / 0 GB</span>
                </div>
                <div class="agg-vram-bar"><div class="agg-vram-bar-fill" id="agg-vram-bar"></div></div>
            </div>
        </div>
    `;
}

// Update overview card — delegates to enhanced updater
function updateOverviewCard(gpuId, gpuInfo, shouldUpdateDOM = true, context = {}) {
    updateEnhancedOverviewCard(gpuId, gpuInfo, shouldUpdateDOM, context);
}

// ============================================
// Compact GPU Overview Card (multi-GPU single-server)
// ============================================

function createCompactOverviewCard(gpuId, gpuInfo) {
    const memory_used = getMetricValue(gpuInfo, 'memory_used', 0);
    const memory_total = getMetricValue(gpuInfo, 'memory_total', 1);
    const memPercent = (memory_used / memory_total) * 100;

    const uuid = getMetricValue(gpuInfo, 'uuid', '');
    const uuidLine = (uuid && uuid !== 'N/A')
        ? '<p class="gpu-uuid" data-collector-text="uuid" data-collector-title></p>' : '';
    const metricHidden = metric => window.GPUHotSettings?.isOverviewMetricVisible?.(metric) === false
        ? ' hidden' : '';
    const chartHidden = metricHidden('chart');
    const chartClass = chartHidden ? ' overview-chart-hidden' : '';
    const visibleMetricCount = window.GPUHotSettings?.visibleOverviewMetricCount?.() ?? 4;
    const extraMetricsVisible = OVERVIEW_EXTRA_METRIC_DEFINITIONS.some(
        metric => window.GPUHotSettings?.isOverviewMetricVisible?.(metric.id) === true
    );

    return renderCollectorText(`
        <div class="overview-gpu-card${chartClass}${extraMetricsVisible ? ' overview-has-extra-metrics' : ''}" data-gpu-id="${gpuId}" data-overview-visible-metrics="${visibleMetricCount}" onclick="switchToView('gpu-${gpuId}')">
            <div class="overview-gpu-name">
                <h2>GPU ${gpuId}</h2>
                <p>${getMetricValue(gpuInfo, 'name', 'Unknown GPU')}</p>
                ${uuidLine}
            </div>
            <div class="overview-metrics">
                <div class="overview-metric" data-overview-metric="utilization"${metricHidden('utilization')}>
                    <div class="overview-metric-value" id="overview-util-${gpuId}">${getMetricValue(gpuInfo, 'utilization', 0)}%</div>
                    <div class="overview-metric-label">UTIL</div>
                </div>
                <div class="overview-metric" data-overview-metric="temperature"${metricHidden('temperature')}>
                    <div class="overview-metric-value" id="overview-temp-${gpuId}">${getMetricValue(gpuInfo, 'temperature', 0)}°</div>
                    <div class="overview-metric-label">TEMP</div>
                </div>
                <div class="overview-metric" data-overview-metric="memory"${metricHidden('memory')}>
                    <div class="overview-metric-value" id="overview-mem-${gpuId}">${Math.round(memPercent)}%</div>
                    <div class="overview-metric-label">MEM</div>
                </div>
                <div class="overview-metric" data-overview-metric="power"${metricHidden('power')}>
                    <div class="overview-metric-value" id="overview-power-${gpuId}">${getMetricValue(gpuInfo, 'power_draw', 0).toFixed(0)}W</div>
                    <div class="overview-metric-label">POWER</div>
                </div>
                ${overviewExtraMetricsMarkup(gpuId)}
            </div>
            <div class="overview-mini-chart" data-overview-metric="chart"${chartHidden}>
                <canvas id="overview-chart-${gpuId}"></canvas>
            </div>
        </div>`, { uuid });
}

// ============================================
// Single GPU Overview — Enhanced Dashboard
// ============================================

function createEnhancedOverviewCard(gpuId, gpuInfo) {

    const memory_used = getMetricValue(gpuInfo, 'memory_used', 0);
    const memory_total = getMetricValue(gpuInfo, 'memory_total', 1);
    const power_draw = getMetricValue(gpuInfo, 'power_draw', 0);
    const power_limit = getMetricValue(gpuInfo, 'power_limit', 1);
    const memPercent = (memory_used / memory_total) * 100;
    const powerPercent = (power_draw / power_limit) * 100;
    const utilization = getMetricValue(gpuInfo, 'utilization', 0);
    const fan_speed = getMetricValue(gpuInfo, 'fan_speed', 0);
    const fan_rpm = formatFanRpm(gpuInfo);
    const temperature = getMetricValue(gpuInfo, 'temperature', 0);

    // Build secondary info items
    let secondaryItems = '';

    if (hasMetric(gpuInfo, 'clock_graphics')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-clock-gr-${gpuId}">${reportedNumber(gpuInfo.clock_graphics)} MHz</span>
                <span class="sgo-info-label">GFX CLOCK</span>
            </div>`;
    }
    if (hasMetric(gpuInfo, 'clock_memory')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-clock-mem-${gpuId}">${reportedNumber(gpuInfo.clock_memory)} MHz</span>
                <span class="sgo-info-label">MEM CLOCK</span>
            </div>`;
    }
    if (hasMetric(gpuInfo, 'performance_state')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-pstate-${gpuId}" data-collector-text="performance_state"></span>
                <span class="sgo-info-label">P-STATE</span>
            </div>`;
    }
    if (hasMetric(gpuInfo, 'memory_utilization')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-mem-util-${gpuId}">${reportedNumber(gpuInfo.memory_utilization)}%</span>
                <span class="sgo-info-label">MEM CTRL</span>
            </div>`;
    }
    if (hasMetric(gpuInfo, 'pcie_gen')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-pcie-${gpuId}">Gen${reportedNumber(gpuInfo.pcie_gen)} x${reportedNumber(gpuInfo.pcie_width, '?')}</span>
                <span class="sgo-info-label">PCIE</span>
            </div>`;
    }
    if (hasMetric(gpuInfo, 'energy_consumption_wh')) {
        secondaryItems += `
            <div class="sgo-info-item">
                <span class="sgo-info-value" id="sgo-energy-${gpuId}">${formatEnergy(gpuInfo.energy_consumption_wh)}</span>
                <span class="sgo-info-label">ENERGY</span>
            </div>`;
    }

    return renderCollectorText(`
        <div class="single-gpu-overview" data-gpu-id="${gpuId}" onclick="switchToView('gpu-${gpuId}')">
            <div class="sgo-header">
                <div class="gpu-detail-header">
                    <span class="gpu-detail-title">GPU ${gpuId}</span>
                    <span class="gpu-detail-name">${gpuInfo.name || 'Unknown'}</span>
                    ${(gpuInfo.uuid && gpuInfo.uuid !== 'N/A')
                        ? '<span class="gpu-detail-uuid" data-collector-text="uuid" data-collector-title></span>' : ''}
                </div>
                <div class="gpu-detail-specs">
                    <span class="spec-tag" id="sgo-fan-badge-${gpuId}">Fan ${fan_speed}%</span>
                    <span class="spec-tag" id="sgo-pstate-badge-${gpuId}" data-collector-text="performance_state"></span>
                    <span class="spec-tag" data-collector-text="driver_version"></span>
                    ${hasMetric(gpuInfo, 'architecture') ? '<span class="spec-tag" data-collector-text="architecture"></span>' : ''}
                    <span class="spec-tag">${gpuInfo._fallback_mode ? 'smi' : 'NVML'}</span>
                </div>
            </div>

            <div class="sgo-metrics-row">
                <div class="metrics-grid--primary sgo-metrics-grid">
                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(utilization, 80, 95)}" id="sgo-util-${gpuId}">${utilization}</span>
                            <span class="metric-unit">%</span>
                        </div>
                        <span class="metric-label">UTILIZATION</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(utilization, 80, 95)}" data-metric="utilization" id="sgo-util-bar-${gpuId}" style="width:${utilization}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(temperature, 75, 85)}" id="sgo-temp-${gpuId}">${temperature}</span>
                            <span class="metric-unit">°C</span>
                        </div>
                        <span class="metric-label">TEMPERATURE</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(temperature, 75, 85)}" data-metric="temperature" id="sgo-temp-bar-${gpuId}" style="width:${Math.min(temperature / 100 * 100, 100)}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(memPercent, 85, 95)}" id="sgo-mem-${gpuId}">${formatMemory(memory_used)}</span>
                            <span class="metric-unit" id="sgo-mem-unit-${gpuId}">${formatMemoryUnit(memory_used)}</span>
                        </div>
                        <span class="metric-label">VRAM</span>
                        <span class="metric-sub" id="sgo-mem-total-${gpuId}">of ${formatMemory(memory_total)}${formatMemoryUnit(memory_total)}</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(memPercent, 85, 95)}" data-metric="memory" id="sgo-mem-bar-${gpuId}" style="width:${memPercent}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(powerPercent, 80, 95)}" id="sgo-power-${gpuId}">${power_draw.toFixed(0)}</span>
                            <span class="metric-unit">W</span>
                        </div>
                        <span class="metric-label">POWER</span>
                        <span class="metric-sub" id="sgo-power-limit-${gpuId}">of ${power_limit.toFixed(0)}W</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(powerPercent, 80, 95)}" data-metric="power" id="sgo-power-bar-${gpuId}" style="width:${powerPercent}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num" id="sgo-fan-${gpuId}">${fan_speed}</span>
                            <span class="metric-unit">%</span>
                        </div>
                        <span class="metric-label">FAN</span>
                        <span class="metric-sub" id="sgo-fan-rpm-${gpuId}"${fan_rpm ? '' : ' hidden'}>${fan_rpm}</span>
                        <div class="bullet-bar"><div class="bullet-fill" data-metric="fan" id="sgo-fan-bar-${gpuId}" style="width:${fan_speed}%"></div></div>
                    </div>
                </div>

                <div class="sgo-mini-chart">
                    <canvas id="overview-chart-${gpuId}"></canvas>
                </div>
            </div>

            ${secondaryItems ? `<div class="sgo-info-strip">${secondaryItems}</div>` : ''}
        </div>
    `, {
        uuid: gpuInfo.uuid,
        performance_state: gpuInfo.performance_state,
        driver_version: gpuInfo.driver_version,
        architecture: gpuInfo.architecture
    });
}

// Update enhanced overview card
function updateEnhancedOverviewCard(gpuId, gpuInfo, shouldUpdateDOM = true, context = {}) {
    rememberOverviewExtraMetrics(gpuId, gpuInfo, context);
    const utilization = getMetricValue(gpuInfo, 'utilization', 0);
    const temperature = getMetricValue(gpuInfo, 'temperature', 0);
    const memory_used = getMetricValue(gpuInfo, 'memory_used', 0);
    const memory_total = getMetricValue(gpuInfo, 'memory_total', 1);
    const power_draw = getMetricValue(gpuInfo, 'power_draw', 0);
    const power_limit = getMetricValue(gpuInfo, 'power_limit', 1);
    const fan_speed = getMetricValue(gpuInfo, 'fan_speed', 0);
    const memPercent = (memory_used / memory_total) * 100;
    const powerPercent = (power_draw / power_limit) * 100;

    if (shouldUpdateDOM) {
        // Hero metrics (single-node enhanced overview: sgo-* IDs)
        const utilEl = document.getElementById(`sgo-util-${gpuId}`);
        const tempEl = document.getElementById(`sgo-temp-${gpuId}`);
        const memEl = document.getElementById(`sgo-mem-${gpuId}`);
        const powerEl = document.getElementById(`sgo-power-${gpuId}`);
        const fanEl = document.getElementById(`sgo-fan-${gpuId}`);

        if (utilEl) { utilEl.textContent = utilization; utilEl.className = `metric-num ${bulletClass(utilization, 80, 95)}`; }
        if (tempEl) { tempEl.textContent = temperature; tempEl.className = `metric-num ${bulletClass(temperature, 75, 85)}`; }
        if (memEl) { memEl.textContent = formatMemory(memory_used); memEl.className = `metric-num ${bulletClass(memPercent, 85, 95)}`; }
        if (powerEl) { powerEl.textContent = power_draw.toFixed(0); powerEl.className = `metric-num ${bulletClass(powerPercent, 80, 95)}`; }
        if (fanEl) fanEl.textContent = fan_speed;
        setFanRpm(`sgo-fan-rpm-${gpuId}`, gpuInfo);

        const memUnitEl = document.getElementById(`sgo-mem-unit-${gpuId}`);
        if (memUnitEl) memUnitEl.textContent = formatMemoryUnit(memory_used);

        // Cluster/hub overview cards (overview-* IDs)
        const clUtilEl = document.getElementById(`overview-util-${gpuId}`);
        const clTempEl = document.getElementById(`overview-temp-${gpuId}`);
        const clMemEl = document.getElementById(`overview-mem-${gpuId}`);
        const clPowerEl = document.getElementById(`overview-power-${gpuId}`);

        if (clUtilEl) clUtilEl.textContent = `${utilization}%`;
        if (clTempEl) clTempEl.textContent = `${temperature}°`;
        if (clMemEl) clMemEl.textContent = `${Math.round(memPercent)}%`;
        if (clPowerEl) clPowerEl.textContent = `${power_draw.toFixed(0)}W`;
        updateOverviewExtraMetrics(document, gpuId, gpuInfo, context);

        // Bullet bars
        const utilBar = document.getElementById(`sgo-util-bar-${gpuId}`);
        const tempBar = document.getElementById(`sgo-temp-bar-${gpuId}`);
        const memBar = document.getElementById(`sgo-mem-bar-${gpuId}`);
        const powerBar = document.getElementById(`sgo-power-bar-${gpuId}`);
        const fanBar = document.getElementById(`sgo-fan-bar-${gpuId}`);

        if (utilBar) { utilBar.style.width = `${utilization}%`; utilBar.className = `bullet-fill ${bulletClass(utilization, 80, 95)}`; }
        if (tempBar) { tempBar.style.width = `${Math.min(temperature / 100 * 100, 100)}%`; tempBar.className = `bullet-fill ${bulletClass(temperature, 75, 85)}`; }
        if (memBar) { memBar.style.width = `${memPercent}%`; memBar.className = `bullet-fill ${bulletClass(memPercent, 85, 95)}`; }
        if (powerBar) { powerBar.style.width = `${powerPercent}%`; powerBar.className = `bullet-fill ${bulletClass(powerPercent, 80, 95)}`; }
        if (fanBar) fanBar.style.width = `${fan_speed}%`;

        // Header badges
        const fanBadgeEl = document.getElementById(`sgo-fan-badge-${gpuId}`);
        if (fanBadgeEl) fanBadgeEl.textContent = `Fan ${fan_speed}%`;
        const pstateBadgeEl = document.getElementById(`sgo-pstate-badge-${gpuId}`);
        if (pstateBadgeEl) pstateBadgeEl.textContent = getMetricValue(gpuInfo, 'performance_state', '');

        // Secondary metrics
        const clockGrEl = document.getElementById(`sgo-clock-gr-${gpuId}`);
        const clockMemEl = document.getElementById(`sgo-clock-mem-${gpuId}`);
        const pstateEl = document.getElementById(`sgo-pstate-${gpuId}`);
        const memUtilEl = document.getElementById(`sgo-mem-util-${gpuId}`);
        const pcieEl = document.getElementById(`sgo-pcie-${gpuId}`);
        const energyEl = document.getElementById(`sgo-energy-${gpuId}`);

        if (clockGrEl) clockGrEl.textContent = `${getMetricValue(gpuInfo, 'clock_graphics', 0)} MHz`;
        if (clockMemEl) clockMemEl.textContent = `${getMetricValue(gpuInfo, 'clock_memory', 0)} MHz`;
        if (pstateEl) pstateEl.textContent = getMetricValue(gpuInfo, 'performance_state', 'N/A');
        if (memUtilEl) memUtilEl.textContent = `${getMetricValue(gpuInfo, 'memory_utilization', 0)}%`;
        if (pcieEl) pcieEl.textContent = `Gen${getMetricValue(gpuInfo, 'pcie_gen', '?')} x${getMetricValue(gpuInfo, 'pcie_width', '?')}`;
        if (energyEl && hasMetric(gpuInfo, 'energy_consumption_wh')) energyEl.textContent = formatEnergy(gpuInfo.energy_consumption_wh);
    }

    // Always update chart data
    updateChart(gpuId, 'utilization', Number(utilization));

    if (charts[gpuId] && charts[gpuId].overviewMini) {
        charts[gpuId].overviewMini.update('none');
    }
}

// ============================================
// Detailed GPU Card — Three Tier Layout
// ============================================

function createGPUCard(gpuId, gpuInfo) {
    const fan_rpm = formatFanRpm(gpuInfo);
    const memory_used = getMetricValue(gpuInfo, 'memory_used', 0);
    const memory_total = getMetricValue(gpuInfo, 'memory_total', 1);
    const power_draw = getMetricValue(gpuInfo, 'power_draw', 0);
    const power_limit = getMetricValue(gpuInfo, 'power_limit', 1);
    const memPercent = (memory_used / memory_total) * 100;
    const powerPercent = (power_draw / power_limit) * 100;
    const utilization = getMetricValue(gpuInfo, 'utilization', 0);
    const fan_speed = getMetricValue(gpuInfo, 'fan_speed', 0);
    const temperature = getMetricValue(gpuInfo, 'temperature', 0);

    // Build optional metric cells
    let extraMetrics = '';

    if (hasMetric(gpuInfo, 'memory_utilization')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="mem-util-${gpuId}">${reportedNumber(gpuInfo.memory_utilization)}</span>
                    <span class="metric-unit">%</span>
                </div>
                <span class="metric-label">MEMORY UTILIZATION</span>
                <span class="metric-sub">Controller Usage</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'clock_graphics')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="clock-gr-${gpuId}">${reportedNumber(gpuInfo.clock_graphics)}</span>
                    <span class="metric-unit">MHz</span>
                </div>
                <span class="metric-label">GRAPHICS CLOCK</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'clock_memory')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="clock-mem-${gpuId}">${reportedNumber(gpuInfo.clock_memory)}</span>
                    <span class="metric-unit">MHz</span>
                </div>
                <span class="metric-label">MEMORY CLOCK</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'performance_state')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="pstate-${gpuId}" data-collector-text="performance_state"></span>
                </div>
                <span class="metric-label">PERFORMANCE STATE</span>
                <span class="metric-sub">Power Mode</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'pcie_gen')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="pcie-${gpuId}">Gen ${reportedNumber(gpuInfo.pcie_gen)}</span>
                </div>
                <span class="metric-label">PCIE LINK</span>
                <span class="metric-sub">x${reportedNumber(gpuInfo.pcie_width, '?')} lanes</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'encoder_sessions')) {
        const encUtil = hasMetric(gpuInfo, 'encoder_utilization') ? `${reportedNumber(gpuInfo.encoder_utilization)}%` : '';
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="encoder-${gpuId}">${reportedNumber(gpuInfo.encoder_sessions)}</span>
                </div>
                <span class="metric-label">ENC SESS</span>
                ${encUtil ? `<span class="metric-sub" id="enc-util-${gpuId}">${encUtil} utilization</span>` : ''}
            </div>`;
    }

    if (hasMetric(gpuInfo, 'clock_sm')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="clock-sm-${gpuId}">${reportedNumber(gpuInfo.clock_sm)}</span>
                    <span class="metric-unit">MHz</span>
                </div>
                <span class="metric-label">SM CLOCK</span>
                <span class="metric-sub" id="clock-sm-max-${gpuId}">MHz / ${reportedNumber(gpuInfo.clock_sm_max, '?')} Max</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'temperature_memory')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="temp-mem-${gpuId}">${reportedNumber(gpuInfo.temperature_memory)}</span>
                    <span class="metric-unit">°C</span>
                </div>
                <span class="metric-label">VRAM TEMP</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'memory_free')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="mem-free-${gpuId}">${formatMemory(gpuInfo.memory_free)}</span>
                    <span class="metric-unit" id="mem-free-unit-${gpuId}">${formatMemoryUnit(gpuInfo.memory_free)}</span>
                </div>
                <span class="metric-label">FREE MEMORY</span>
                <span class="metric-sub">Available VRAM</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'decoder_sessions')) {
        const decUtil = hasMetric(gpuInfo, 'decoder_utilization') ? `${reportedNumber(gpuInfo.decoder_utilization)}%` : '';
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="decoder-${gpuId}">${reportedNumber(gpuInfo.decoder_sessions)}</span>
                </div>
                <span class="metric-label">DEC SESS</span>
                ${decUtil ? `<span class="metric-sub" id="dec-util-${gpuId}">${decUtil} utilization</span>` : ''}
            </div>`;
    }

    if (hasMetric(gpuInfo, 'energy_consumption_wh')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="energy-${gpuId}">${formatEnergy(gpuInfo.energy_consumption_wh)}</span>
                </div>
                <span class="metric-label">TOTAL ENERGY</span>
                <span class="metric-sub">Since driver load</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'clock_video')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="clock-video-${gpuId}">${reportedNumber(gpuInfo.clock_video)}</span>
                    <span class="metric-unit">MHz</span>
                </div>
                <span class="metric-label">VIDEO CLOCK</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'pcie_gen_max')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="pcie-max-${gpuId}">Gen ${reportedNumber(gpuInfo.pcie_gen_max)}</span>
                </div>
                <span class="metric-label">MAX PCIE</span>
                <span class="metric-sub" id="pcie-max-width-${gpuId}">x${reportedNumber(gpuInfo.pcie_width_max, '?')} Max</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'bar1_memory_used')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="bar1-mem-${gpuId}">${formatMemory(gpuInfo.bar1_memory_used)}</span>
                    <span class="metric-unit" id="bar1-mem-unit-${gpuId}">${formatMemoryUnit(gpuInfo.bar1_memory_used)}</span>
                </div>
                <span class="metric-label">BAR1 MEMORY</span>
                <span class="metric-sub" id="bar1-mem-total-${gpuId}">of ${formatMemory(gpuInfo.bar1_memory_total || 0)}${formatMemoryUnit(gpuInfo.bar1_memory_total || 0)}</span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'brand') || hasMetric(gpuInfo, 'architecture')) {
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="brand-${gpuId}" data-collector-text="brand"></span>
                </div>
                <span class="metric-label">BRAND / ARCHITECTURE</span>
                <span class="metric-sub" id="arch-${gpuId}" data-collector-text="architecture"></span>
            </div>`;
    }

    if (hasMetric(gpuInfo, 'graphics_processes_count')) {
        const computeProcs = getMetricValue(gpuInfo, 'compute_processes_count', 0);
        const graphicsProcs = getMetricValue(gpuInfo, 'graphics_processes_count', 0);
        extraMetrics += `
            <div class="metric-cell">
                <div class="metric-num-row">
                    <span class="metric-num" id="proc-counts-${gpuId}">C:${computeProcs} G:${graphicsProcs}</span>
                </div>
                <span class="metric-label">PROCESS COUNTS</span>
                <span class="metric-sub">Compute / Graphics</span>
            </div>`;
    }

    const throttleStatus = window.GPUHotThrottle.status(gpuInfo.throttle_reasons, gpuInfo.vendor);
    const isThrottling = throttleStatus.active;
    extraMetrics += `
        <div class="metric-cell">
            <div class="metric-num-row">
                <span class="metric-num" id="throttle-${gpuId}" data-collector-text="throttle_reasons"${isThrottling ? ' style="color:var(--warning);"' : ''}></span>
            </div>
            <span class="metric-label">THROTTLE STATUS</span>
            <span class="metric-sub" id="throttle-sub-${gpuId}">${isThrottling ? 'Throttling' : 'Not throttled'}</span>
        </div>`;

    // Build sparkline chart containers
    let pcieChart = '';
    if (hasMetric(gpuInfo, 'pcie_rx_throughput') || hasMetric(gpuInfo, 'pcie_tx_throughput')) {
        pcieChart = `
            <div class="sparkline-container" data-chart-type="pcie" data-gpu-id="${gpuId}">
                <div class="sparkline-header">
                    <span class="sparkline-title">PCIe</span>
                    <div class="sparkline-stats">
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">RX</span>
                            <span class="sparkline-stat-value" id="stat-pcie-rx-current-${gpuId}">0 KB/s</span>
                        </div>
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">TX</span>
                            <span class="sparkline-stat-value" id="stat-pcie-tx-current-${gpuId}">0 KB/s</span>
                        </div>
                    </div>
                </div>
                <div class="sparkline-canvas-wrap"><canvas id="chart-pcie-${gpuId}"></canvas></div>
            </div>`;
    }

    let appClocksChart = '';
    if (hasMetric(gpuInfo, 'clock_graphics_app') || hasMetric(gpuInfo, 'clock_memory_app')) {
        appClocksChart = `
            <div class="sparkline-container" data-chart-type="appclocks" data-gpu-id="${gpuId}">
                <div class="sparkline-header">
                    <span class="sparkline-title">App Clocks</span>
                    <div class="sparkline-stats">
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">GFX</span>
                            <span class="sparkline-stat-value" id="stat-app-clock-gr-${gpuId}">0</span>
                        </div>
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">MEM</span>
                            <span class="sparkline-stat-value" id="stat-app-clock-mem-${gpuId}">0</span>
                        </div>
                    </div>
                </div>
                <div class="sparkline-canvas-wrap"><canvas id="chart-appclocks-${gpuId}"></canvas></div>
            </div>`;
    }

    let encDecChart = '';
    if (hasMetric(gpuInfo, 'encoder_utilization') || hasMetric(gpuInfo, 'decoder_utilization')) {
        encDecChart = `
            <div class="sparkline-container" data-chart-type="encoderDecoder" data-gpu-id="${gpuId}">
                <div class="sparkline-header">
                    <span class="sparkline-title">Encoder / Decoder</span>
                    <div class="sparkline-stats">
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">Enc</span>
                            <span class="sparkline-stat-value" id="stat-encDec-enc-current-${gpuId}">0%</span>
                        </div>
                        <div class="sparkline-stat">
                            <span class="sparkline-stat-label">Dec</span>
                            <span class="sparkline-stat-value" id="stat-encDec-dec-current-${gpuId}">0%</span>
                        </div>
                    </div>
                </div>
                <div class="sparkline-canvas-wrap"><canvas id="chart-encoderDecoder-${gpuId}"></canvas></div>
            </div>`;
    }

    return renderCollectorText(`
        <div class="gpu-card" id="gpu-${gpuId}">
            <!-- Header -->
            <div class="gpu-detail-header">
                <span class="gpu-detail-title">GPU ${gpuId}</span>
                <span class="gpu-detail-name">${gpuInfo.name || 'Unknown'}</span>
            </div>
            <div class="gpu-detail-specs">
                <span class="spec-tag" id="fan-${gpuId}">Fan ${fan_speed}%</span>
                <span class="spec-tag" id="pstate-header-${gpuId}" data-collector-text="performance_state"></span>
                <span class="spec-tag" id="pcie-header-${gpuId}">PCIe ${reportedNumber(gpuInfo.pcie_gen, '?')}</span>
                <span class="spec-tag" data-collector-text="driver_version"></span>
                <span class="spec-tag">${gpuInfo._fallback_mode ? 'smi' : 'NVML'}</span>
            </div>

            <!-- PRIMARY TIER: Hero metrics with identity-colored bars -->
            <div class="metrics-panel">
                <div class="metrics-grid--primary">
                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(utilization, 80, 95)}" id="util-text-${gpuId}">${utilization}</span>
                            <span class="metric-unit">%</span>
                        </div>
                        <span class="metric-label">GPU UTILIZATION</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(utilization, 80, 95)}" data-metric="utilization" id="util-bar-${gpuId}" style="width:${utilization}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(temperature, 75, 85)}" id="temp-${gpuId}">${temperature}</span>
                            <span class="metric-unit">°C</span>
                        </div>
                        <span class="metric-label">TEMPERATURE</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(temperature, 75, 85)}" data-metric="temperature" id="temp-bar-${gpuId}" style="width:${Math.min(temperature / 100 * 100, 100)}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(memPercent, 85, 95)}" id="mem-${gpuId}">${formatMemory(memory_used)}</span>
                            <span class="metric-unit" id="mem-unit-${gpuId}">${formatMemoryUnit(memory_used)}</span>
                        </div>
                        <span class="metric-label">MEMORY USAGE</span>
                        <span class="metric-sub" id="mem-total-${gpuId}">of ${formatMemory(memory_total)}${formatMemoryUnit(memory_total)}</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(memPercent, 85, 95)}" data-metric="memory" id="mem-bar-${gpuId}" style="width:${memPercent}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num ${bulletClass(powerPercent, 80, 95)}" id="power-${gpuId}">${power_draw.toFixed(0)}</span>
                            <span class="metric-unit">W</span>
                        </div>
                        <span class="metric-label">POWER DRAW</span>
                        <span class="metric-sub" id="power-limit-${gpuId}">of ${power_limit.toFixed(0)}W</span>
                        <div class="bullet-bar"><div class="bullet-fill ${bulletClass(powerPercent, 80, 95)}" data-metric="power" id="power-bar-${gpuId}" style="width:${powerPercent}%"></div></div>
                    </div>

                    <div class="metric-cell">
                        <div class="metric-num-row">
                            <span class="metric-num" id="fan-val-${gpuId}">${fan_speed}</span>
                            <span class="metric-unit">%</span>
                        </div>
                        <span class="metric-label">FAN</span>
                        <span class="metric-sub" id="fan-rpm-${gpuId}"${fan_rpm ? '' : ' hidden'}>${fan_rpm}</span>
                        <div class="bullet-bar"><div class="bullet-fill" data-metric="fan" id="fan-bar-${gpuId}" style="width:${fan_speed}%"></div></div>
                    </div>
                </div>
            </div>

            <!-- SECONDARY TIER: Reference data -->
            ${extraMetrics ? `<div class="metrics-grid--secondary">${extraMetrics}</div>` : ''}

            <!-- MID TIER: Sparklines -->
            <div class="sparklines-section">
                <div class="sparklines-grid">
                    <div class="sparkline-container" data-chart-type="utilization" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Utilization</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-utilization-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-utilization-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-utilization-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-utilization-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-utilization-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="temperature" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Temperature</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-temperature-current-${gpuId}">0°C</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-temperature-min-${gpuId}">0°C</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-temperature-max-${gpuId}">0°C</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-temperature-avg-${gpuId}">0°C</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-temperature-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="memory" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Memory</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-memory-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-memory-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-memory-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-memory-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-memory-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="power" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Power</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-power-current-${gpuId}">0W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-power-min-${gpuId}">0W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-power-max-${gpuId}">0W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-power-avg-${gpuId}">0W</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-power-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="fanSpeed" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Fan Speed</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-fanSpeed-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-fanSpeed-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-fanSpeed-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-fanSpeed-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-fanSpeed-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="clocks" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Clocks</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-clocks-current-${gpuId}">0 MHz</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-clocks-min-${gpuId}">0 MHz</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-clocks-max-${gpuId}">0 MHz</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-clocks-avg-${gpuId}">0 MHz</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-clocks-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="efficiency" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Efficiency</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-efficiency-current-${gpuId}">0 %/W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-efficiency-min-${gpuId}">0 %/W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-efficiency-max-${gpuId}">0 %/W</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-efficiency-avg-${gpuId}">0 %/W</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-efficiency-${gpuId}"></canvas></div>
                    </div>

                    ${pcieChart}
                    ${appClocksChart}
                    ${encDecChart}
                </div>
            </div>

            <!-- System Metrics -->
            <div class="system-sparklines-section">
                <div class="system-sparklines-label">System</div>
                <div class="sparklines-grid">
                    <div class="sparkline-container" data-chart-type="systemCpu" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">CPU</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-systemCpu-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-systemCpu-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-systemCpu-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-systemCpu-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemCpu-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" data-chart-type="systemMemory" data-gpu-id="${gpuId}">
                        <div class="sparkline-header">
                            <span class="sparkline-title">RAM</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-systemMemory-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-systemMemory-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-systemMemory-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-systemMemory-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemMemory-${gpuId}"></canvas></div>
                        <div class="sparkline-sub" id="sys-mem-sub-${gpuId}"></div>
                    </div>

                    <div class="sparkline-container" id="sys-swap-${gpuId}" data-chart-type="systemSwap" data-gpu-id="${gpuId}" style="display:none">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Swap</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-systemSwap-current-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-systemSwap-min-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-systemSwap-max-${gpuId}">0%</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-systemSwap-avg-${gpuId}">0%</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemSwap-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" id="sys-net-${gpuId}" data-chart-type="systemNetIo" data-gpu-id="${gpuId}" style="display:none">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Network</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">RX</span><span class="sparkline-stat-value" id="stat-systemNetIo-rx-current-${gpuId}">0 KB/s</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">TX</span><span class="sparkline-stat-value" id="stat-systemNetIo-tx-current-${gpuId}">0 KB/s</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemNetIo-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" id="sys-disk-${gpuId}" data-chart-type="systemDiskIo" data-gpu-id="${gpuId}" style="display:none">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Disk</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Read</span><span class="sparkline-stat-value" id="stat-systemDiskIo-read-current-${gpuId}">0 KB/s</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Write</span><span class="sparkline-stat-value" id="stat-systemDiskIo-write-current-${gpuId}">0 KB/s</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemDiskIo-${gpuId}"></canvas></div>
                    </div>

                    <div class="sparkline-container" id="sys-load-${gpuId}" data-chart-type="systemLoadAvg" data-gpu-id="${gpuId}" style="display:none">
                        <div class="sparkline-header">
                            <span class="sparkline-title">Load Average</span>
                            <div class="sparkline-stats">
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Cur</span><span class="sparkline-stat-value" id="stat-systemLoadAvg-current-${gpuId}">0</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Min</span><span class="sparkline-stat-value" id="stat-systemLoadAvg-min-${gpuId}">0</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Max</span><span class="sparkline-stat-value" id="stat-systemLoadAvg-max-${gpuId}">0</span></div>
                                <div class="sparkline-stat"><span class="sparkline-stat-label">Avg</span><span class="sparkline-stat-value" id="stat-systemLoadAvg-avg-${gpuId}">0</span></div>
                            </div>
                        </div>
                        <div class="sparkline-canvas-wrap"><canvas id="chart-systemLoadAvg-${gpuId}"></canvas></div>
                    </div>
                </div>
            </div>
        </div>
    `, {
        performance_state: gpuInfo.performance_state,
        driver_version: gpuInfo.driver_version,
        architecture: gpuInfo.architecture || 'Unknown',
        brand: gpuInfo.brand || 'N/A',
        throttle_reasons: throttleStatus.display
    });
}

// ============================================
// Update GPU Display
// ============================================

function updateGPUDisplay(gpuId, gpuInfo, shouldUpdateDOM = true) {
    const utilization = getMetricValue(gpuInfo, 'utilization', 0);
    const temperature = getMetricValue(gpuInfo, 'temperature', 0);
    const memory_used = getMetricValue(gpuInfo, 'memory_used', 0);
    const memory_total = getMetricValue(gpuInfo, 'memory_total', 1);
    const power_draw = getMetricValue(gpuInfo, 'power_draw', 0);
    const power_limit = getMetricValue(gpuInfo, 'power_limit', 1);
    const fan_speed = getMetricValue(gpuInfo, 'fan_speed', 0);

    if (shouldUpdateDOM) {
        // Core metrics
        const utilEl = document.getElementById(`util-text-${gpuId}`);
        const tempEl = document.getElementById(`temp-${gpuId}`);
        const memEl = document.getElementById(`mem-${gpuId}`);
        const powerEl = document.getElementById(`power-${gpuId}`);
        const fanEl = document.getElementById(`fan-${gpuId}`);
        const fanValEl = document.getElementById(`fan-val-${gpuId}`);

        // Bullet bars
        const memPercent = (memory_used / memory_total) * 100;
        const powerPercent = (power_draw / power_limit) * 100;

        if (utilEl) { utilEl.textContent = `${utilization}`; utilEl.className = `metric-num ${bulletClass(utilization, 80, 95)}`; }
        if (tempEl) { tempEl.textContent = `${temperature}`; tempEl.className = `metric-num ${bulletClass(temperature, 75, 85)}`; }
        if (memEl) { memEl.textContent = formatMemory(memory_used); memEl.className = `metric-num ${bulletClass(memPercent, 85, 95)}`; }
        const memUnitEl = document.getElementById(`mem-unit-${gpuId}`);
        if (memUnitEl) memUnitEl.textContent = formatMemoryUnit(memory_used);
        if (powerEl) { powerEl.textContent = `${power_draw.toFixed(0)}`; powerEl.className = `metric-num ${bulletClass(powerPercent, 80, 95)}`; }
        if (fanEl) fanEl.textContent = `Fan ${fan_speed}%`;
        if (fanValEl) fanValEl.textContent = `${fan_speed}`;
        setFanRpm(`fan-rpm-${gpuId}`, gpuInfo);

        const utilBar = document.getElementById(`util-bar-${gpuId}`);
        const tempBar = document.getElementById(`temp-bar-${gpuId}`);
        const memBar = document.getElementById(`mem-bar-${gpuId}`);
        const powerBar = document.getElementById(`power-bar-${gpuId}`);
        const fanBar = document.getElementById(`fan-bar-${gpuId}`);

        if (utilBar) {
            utilBar.style.width = `${utilization}%`;
            utilBar.className = `bullet-fill ${bulletClass(utilization, 80, 95)}`;
        }
        if (tempBar) {
            tempBar.style.width = `${Math.min(temperature / 100 * 100, 100)}%`;
            tempBar.className = `bullet-fill ${bulletClass(temperature, 75, 85)}`;
        }
        if (memBar) {
            memBar.style.width = `${memPercent}%`;
            memBar.className = `bullet-fill ${bulletClass(memPercent, 85, 95)}`;
        }
        if (powerBar) {
            powerBar.style.width = `${powerPercent}%`;
            powerBar.className = `bullet-fill ${bulletClass(powerPercent, 80, 95)}`;
        }
        if (fanBar) fanBar.style.width = `${fan_speed}%`;

        // Secondary metrics (only if elements exist)
        const clockGrEl = document.getElementById(`clock-gr-${gpuId}`);
        const clockMemEl = document.getElementById(`clock-mem-${gpuId}`);
        const clockSmEl = document.getElementById(`clock-sm-${gpuId}`);
        const memUtilEl = document.getElementById(`mem-util-${gpuId}`);
        const pcieEl = document.getElementById(`pcie-${gpuId}`);
        const pstateEl = document.getElementById(`pstate-${gpuId}`);
        const encoderEl = document.getElementById(`encoder-${gpuId}`);

        if (clockGrEl) clockGrEl.textContent = `${getMetricValue(gpuInfo, 'clock_graphics', 0)}`;
        if (clockMemEl) clockMemEl.textContent = `${getMetricValue(gpuInfo, 'clock_memory', 0)}`;
        if (clockSmEl) clockSmEl.textContent = `${getMetricValue(gpuInfo, 'clock_sm', 0)}`;
        if (memUtilEl) memUtilEl.textContent = `${getMetricValue(gpuInfo, 'memory_utilization', 0)}`;
        if (pcieEl) pcieEl.textContent = `Gen ${getMetricValue(gpuInfo, 'pcie_gen', 'N/A')}`;
        if (pstateEl) pstateEl.textContent = `${getMetricValue(gpuInfo, 'performance_state', 'N/A')}`;
        if (encoderEl) encoderEl.textContent = `${getMetricValue(gpuInfo, 'encoder_sessions', 0)}`;

        // Encoder/Decoder utilization sub-labels
        const encUtilEl = document.getElementById(`enc-util-${gpuId}`);
        if (encUtilEl) encUtilEl.textContent = `${getMetricValue(gpuInfo, 'encoder_utilization', 0)}% utilization`;

        // Header badges
        const pstateHeaderEl = document.getElementById(`pstate-header-${gpuId}`);
        const pcieHeaderEl = document.getElementById(`pcie-header-${gpuId}`);
        if (pstateHeaderEl) pstateHeaderEl.textContent = `${getMetricValue(gpuInfo, 'performance_state', 'N/A')}`;
        if (pcieHeaderEl) pcieHeaderEl.textContent = `PCIe ${getMetricValue(gpuInfo, 'pcie_gen', 'N/A')}`;

        // Memory sublabel
        const memTotalEl = document.getElementById(`mem-total-${gpuId}`);
        if (memTotalEl) memTotalEl.textContent = `of ${formatMemory(memory_total)}${formatMemoryUnit(memory_total)}`;

        // Power sublabel
        const powerLimitEl = document.getElementById(`power-limit-${gpuId}`);
        if (powerLimitEl) powerLimitEl.textContent = `of ${power_limit.toFixed(0)}W`;

        // Advanced metrics
        const tempMemEl = document.getElementById(`temp-mem-${gpuId}`);
        const memFreeEl = document.getElementById(`mem-free-${gpuId}`);
        const decoderEl = document.getElementById(`decoder-${gpuId}`);
        const throttleEl = document.getElementById(`throttle-${gpuId}`);

        if (tempMemEl) {
            const tempMem = getMetricValue(gpuInfo, 'temperature_memory', null);
            tempMemEl.textContent = tempMem !== null ? `${tempMem}` : 'N/A';
        }
        if (memFreeEl) {
            const memFreeVal = getMetricValue(gpuInfo, 'memory_free', 0);
            memFreeEl.textContent = formatMemory(memFreeVal);
            const memFreeUnitEl = document.getElementById(`mem-free-unit-${gpuId}`);
            if (memFreeUnitEl) memFreeUnitEl.textContent = formatMemoryUnit(memFreeVal);
        }
        if (decoderEl) {
            const ds = getMetricValue(gpuInfo, 'decoder_sessions', null);
            decoderEl.textContent = ds !== null ? `${ds}` : 'N/A';
        }
        const decUtilEl = document.getElementById(`dec-util-${gpuId}`);
        if (decUtilEl) decUtilEl.textContent = `${getMetricValue(gpuInfo, 'decoder_utilization', 0)}% utilization`;
        if (throttleEl) {
            const throttleStatus = window.GPUHotThrottle.status(gpuInfo.throttle_reasons, gpuInfo.vendor);
            throttleEl.textContent = throttleStatus.display;
            throttleEl.style.color = throttleStatus.active ? 'var(--warning)' : '';
            const throttleSubEl = document.getElementById(`throttle-sub-${gpuId}`);
            if (throttleSubEl) throttleSubEl.textContent = throttleStatus.active ? 'Throttling' : 'Not throttled';
        }

        if (hasMetric(gpuInfo, 'energy_consumption_wh')) {
            const energyEl = document.getElementById(`energy-${gpuId}`);
            if (energyEl) energyEl.textContent = formatEnergy(gpuInfo.energy_consumption_wh);
        }

        // Video clock
        const clockVideoEl = document.getElementById(`clock-video-${gpuId}`);
        if (clockVideoEl) clockVideoEl.textContent = `${getMetricValue(gpuInfo, 'clock_video', 0)}`;

        // Max PCIe
        const pcieMaxEl = document.getElementById(`pcie-max-${gpuId}`);
        if (pcieMaxEl) pcieMaxEl.textContent = `Gen ${getMetricValue(gpuInfo, 'pcie_gen_max', 'N/A')}`;

        // BAR1 memory
        const bar1MemEl = document.getElementById(`bar1-mem-${gpuId}`);
        if (bar1MemEl) {
            const bar1MemVal = getMetricValue(gpuInfo, 'bar1_memory_used', 0);
            bar1MemEl.textContent = formatMemory(bar1MemVal);
            const bar1MemUnitEl = document.getElementById(`bar1-mem-unit-${gpuId}`);
            if (bar1MemUnitEl) bar1MemUnitEl.textContent = formatMemoryUnit(bar1MemVal);
        }
        const bar1TotalEl = document.getElementById(`bar1-mem-total-${gpuId}`);
        if (bar1TotalEl) {
            const bar1Total = getMetricValue(gpuInfo, 'bar1_memory_total', 0);
            bar1TotalEl.textContent = `of ${formatMemory(bar1Total)}${formatMemoryUnit(bar1Total)}`;
        }

        // Brand / Architecture
        const brandEl = document.getElementById(`brand-${gpuId}`);
        if (brandEl) brandEl.textContent = `${getMetricValue(gpuInfo, 'brand', 'N/A')}`;
        const archEl = document.getElementById(`arch-${gpuId}`);
        if (archEl) archEl.textContent = `${getMetricValue(gpuInfo, 'architecture', 'Unknown')}`;

        // Process counts
        const procCountsEl = document.getElementById(`proc-counts-${gpuId}`);
        if (procCountsEl) {
            const computeProcs = getMetricValue(gpuInfo, 'compute_processes_count', 0);
            const graphicsProcs = getMetricValue(gpuInfo, 'graphics_processes_count', 0);
            procCountsEl.textContent = `C:${computeProcs} G:${graphicsProcs}`;
        }
    }

    // Always update charts
    const memPercent = (memory_used / memory_total) * 100;

    updateChart(gpuId, 'utilization', utilization);
    updateChart(gpuId, 'temperature', temperature);
    updateChart(gpuId, 'memory', memPercent);
    updateChart(gpuId, 'power', power_draw);
    updateChart(gpuId, 'fanSpeed', fan_speed);
    updateChart(gpuId, 'clocks',
        getMetricValue(gpuInfo, 'clock_graphics', 0),
        getMetricValue(gpuInfo, 'clock_sm', 0),
        getMetricValue(gpuInfo, 'clock_memory', 0)
    );

    const efficiency = power_draw > 0 ? utilization / power_draw : 0;
    updateChart(gpuId, 'efficiency', efficiency);

    if (hasMetric(gpuInfo, 'pcie_rx_throughput') || hasMetric(gpuInfo, 'pcie_tx_throughput')) {
        updateChart(gpuId, 'pcie',
            gpuInfo.pcie_rx_throughput || 0,
            gpuInfo.pcie_tx_throughput || 0
        );
    }

    if (hasMetric(gpuInfo, 'clock_graphics_app') || hasMetric(gpuInfo, 'clock_memory_app')) {
        updateChart(gpuId, 'appclocks',
            gpuInfo.clock_graphics_app || gpuInfo.clock_graphics || 0,
            gpuInfo.clock_memory_app || gpuInfo.clock_memory || 0,
            gpuInfo.clock_sm_app || gpuInfo.clock_sm || 0,
            gpuInfo.clock_video_app || gpuInfo.clock_video || 0
        );
    }

    if (hasMetric(gpuInfo, 'encoder_utilization') || hasMetric(gpuInfo, 'decoder_utilization')) {
        updateChart(gpuId, 'encoderDecoder',
            gpuInfo.encoder_utilization || 0,
            gpuInfo.decoder_utilization || 0
        );
    }
}

// ============================================
// Process Table
// ============================================

let latestProcesses = [];

function displayedProcessModel(model) {
    if (typeof model !== 'string') return '';
    return model.trim().split('/').pop() || '';
}

function updateProcesses(processes) {
    latestProcesses = Array.isArray(processes) ? processes : [];
    refreshOverviewProcessModels();
    refreshDetailProcessModels();
    renderProcessesForView(typeof currentTab === 'string' ? currentTab : 'overview');
}

function modelsForGpuKey(gpuKey) {
    if (window.GPUHotSettings?.settings?.['overview.showModel'] !== true) return [];
    return [...new Set(latestProcesses
        .filter(process => String(process.gpu_key) === gpuKey)
        .map(process => displayedProcessModel(process.model))
        .filter(Boolean))];
}

function setOverviewCardModels(card) {
    const nameBlock = card.querySelector('.overview-gpu-name, .gpu-detail-header');
    if (!nameBlock) return;
    const models = modelsForGpuKey(card.dataset.gpuId);
    const oldLines = [...nameBlock.querySelectorAll('.overview-gpu-model')];
    if (oldLines.length === models.length
        && oldLines.every((line, index) => line.textContent === models[index])) return;
    oldLines.forEach(line => line.remove());
    const anchor = nameBlock.querySelector('.gpu-uuid, .gpu-detail-uuid');
    models.forEach(model => {
        const line = document.createElement(card.classList.contains('single-gpu-overview') ? 'span' : 'p');
        line.className = 'overview-gpu-model';
        line.textContent = model;
        nameBlock.insertBefore(line, anchor);
    });
}

function refreshOverviewProcessModels() {
    document.querySelectorAll('#overview-container .overview-gpu-card, #overview-container .single-gpu-overview')
        .forEach(setOverviewCardModels);
}

window.refreshOverviewProcessModels = refreshOverviewProcessModels;

function refreshDetailProcessModels() {
    document.querySelectorAll('.tab-content[id^="tab-gpu-"]').forEach(tab => {
        const title = tab.querySelector('.gpu-detail-title');
        if (!title) return;
        const model = modelsForGpuKey(tab.id.slice('tab-gpu-'.length)).join(', ');
        const suffix = title.querySelector('.gpu-detail-model-suffix');
        const separator = title.querySelector('.gpu-detail-model-separator');
        if (!model) {
            suffix?.remove();
            separator?.remove();
            return;
        }
        if (suffix?.textContent === model && separator) return;
        const modelSuffix = suffix || document.createElement('span');
        modelSuffix.className = 'gpu-detail-model-suffix';
        modelSuffix.replaceChildren();
        // Keep a short suffix together, but allow long model names to wrap at
        // their own separators before the browser has to break a letter run.
        let start = 0;
        for (let index = 0; index < model.length; index += 1) {
            if (!'-_:.'.includes(model[index])) continue;
            modelSuffix.appendChild(document.createTextNode(model.slice(start, index + 1)));
            modelSuffix.appendChild(document.createElement('wbr'));
            start = index + 1;
        }
        modelSuffix.appendChild(document.createTextNode(model.slice(start)));
        if (!separator) {
            const modelSeparator = document.createElement('span');
            modelSeparator.className = 'gpu-detail-model-separator';
            modelSeparator.textContent = ' - ';
            title.insertBefore(modelSeparator, suffix);
        }
        if (!suffix) title.appendChild(modelSuffix);
    });
}

window.refreshDetailProcessModels = refreshDetailProcessModels;

function processesForView(processes, viewName) {
    if (!viewName || !viewName.startsWith('gpu-')) return processes;

    const gpuKey = viewName.slice(4);
    return processes.filter(process => String(process.gpu_key) === gpuKey);
}

function appendProcessCell(row, className, value) {
    const cell = document.createElement('div');
    cell.className = className;
    cell.textContent = String(value);
    row.appendChild(cell);
    return cell;
}

function processIdentity(process) {
    const nodeName = String(process.node_name || window.DEFAULT_NODE_NAME || 'GPU Server');
    const gpuId = String(process.gpu_id ?? '');
    return { nodeName, gpuId };
}

function processCard(process) {
    const { nodeName, gpuId } = processIdentity(process);
    const key = JSON.stringify([nodeName, gpuId]);
    const card = Array.from(document.querySelectorAll('[data-layout-order-key]'))
        .find(element => element.dataset.layoutOrderKey === key)
        || Array.from(document.querySelectorAll('.single-gpu-overview[data-gpu-id]'))
            .find(element => element.dataset.gpuId === gpuId);
    const model = card?.querySelector('.overview-gpu-name p, .gpu-detail-name')?.textContent?.trim();
    return { nodeName, gpuId, label: model || `GPU ${gpuId || 'Unknown'}` };
}

function processesInDashboardOrder(processes) {
    const positions = new Map();
    document.querySelectorAll('#overview-container [data-layout-order-key]').forEach((card, index) => {
        positions.set(card.dataset.layoutOrderKey, index);
    });
    return processes.map((process, index) => ({ process, index })).sort((left, right) => {
        const leftCard = processIdentity(left.process);
        const rightCard = processIdentity(right.process);
        const leftPosition = positions.get(JSON.stringify([leftCard.nodeName, leftCard.gpuId])) ?? Number.MAX_SAFE_INTEGER;
        const rightPosition = positions.get(JSON.stringify([rightCard.nodeName, rightCard.gpuId])) ?? Number.MAX_SAFE_INTEGER;
        return leftPosition - rightPosition || left.index - right.index;
    }).map(entry => entry.process);
}

function appendProcessHeader(container) {
    const header = document.createElement('div');
    header.className = 'process-table-header';

    for (const [className, label] of [
        ['process-system-heading', 'System'],
        ['process-card-heading', 'Card'],
        ['process-model-heading', 'Model'],
        ['process-name-heading', 'Process'],
        ['process-pid-heading', 'PID'],
        ['process-memory-heading', 'VRAM']
    ]) {
        const heading = document.createElement('span');
        heading.className = className;
        heading.textContent = label;
        header.appendChild(heading);
    }

    container.appendChild(header);
}

function showEmptyProcesses(container, viewName) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    const emptyText = document.createElement('div');
    emptyText.className = 'empty-state-text';
    emptyText.textContent = viewName && viewName.startsWith('gpu-')
        ? 'No active processes on this GPU'
        : 'No active GPU processes';
    emptyState.appendChild(emptyText);
    container.replaceChildren(emptyState);
}

function createProcessRow(process) {
    const row = document.createElement('div');
    row.className = 'process-item';
    const card = processCard(process);
    const systemCell = appendProcessCell(row, 'process-system', process.node_name || 'This system');
    window.GPUHotSettings?.bindNodeLabel?.(systemCell, card.nodeName);
    const cardCell = appendProcessCell(row, 'process-card', card.label);
    window.GPUHotSettings?.bindGpuLabel?.(cardCell, card.nodeName, card.gpuId, card.label);
    appendProcessCell(row, 'process-model', displayedProcessModel(process.model));
    appendProcessCell(row, 'process-name', process.name || 'Unknown process');
    appendProcessCell(row, 'process-pid', process.pid ?? 'Unknown');
    appendProcessCell(row, 'process-memory', `${formatMemory(process.memory)}${formatMemoryUnit(process.memory)}`);
    return row;
}

function renderProcessesForView(viewName) {
    const container = document.getElementById('processes-container');
    if (!container) return;

    const visibleProcesses = processesForView(latestProcesses, viewName);
    const countEl = document.getElementById('process-count');
    if (countEl) countEl.textContent = String(visibleProcesses.length);
    if (visibleProcesses.length === 0) {
        showEmptyProcesses(container, viewName);
        return;
    }

    const processTable = document.createDocumentFragment();
    appendProcessHeader(processTable);
    processesInDashboardOrder(visibleProcesses)
        .forEach(process => processTable.appendChild(createProcessRow(process)));
    container.replaceChildren(processTable);
}
