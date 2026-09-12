/**
 * Chart configuration factory — GPU Studio
 * Grayscale sparklines, no fills, no color except alerts
 */

function readColorToken(tokenName) {
    return getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
}

function colorTokenWithAlpha(tokenName, alpha) {
    return `rgba(${readColorToken(tokenName)}, ${alpha})`;
}

// Sparkline palette — monochromatic
const SPARK = {
    get stroke() { return colorTokenWithAlpha('--neutral-rgb', 0.6); },
    get strokeLight() { return colorTokenWithAlpha('--neutral-rgb', 0.35); },
    get strokeDim() { return colorTokenWithAlpha('--neutral-rgb', 0.2); },
    get grid() { return colorTokenWithAlpha('--neutral-rgb', 0.04); },
    get tick() { return colorTokenWithAlpha('--neutral-rgb', 0.4); },
    get tooltipBg() { return readColorToken('--bg-surface'); },
    get warning() { return readColorToken('--warning'); },
};

// Sparkline warning thresholds — line turns orange above these values
const SPARK_THRESHOLDS = {
    utilization: 80,
    temperature: 75,
    memory: 85,
};

// Base chart options — minimal sparkline
function getBaseChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
            intersect: false,
            mode: 'index'
        },
        elements: {
            point: { radius: 0, hitRadius: 8 },
            line: { borderCapStyle: 'round', borderJoinStyle: 'round' }
        },
        layout: {
            padding: { left: 0, right: 0, top: 2, bottom: 0 }
        },
        scales: {
            x: {
                display: false
            },
            y: {
                min: 0,
                display: true,
                position: 'right',
                grid: {
                    color: SPARK.grid,
                    drawBorder: false,
                    lineWidth: 1
                },
                ticks: {
                    color: SPARK.tick,
                    font: { size: 10, family: "'SF Mono', 'Menlo', 'Consolas', monospace" },
                    padding: 8,
                    maxTicksLimit: 3
                },
                border: {
                    display: false
                }
            }
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: SPARK.tooltipBg,
                titleColor: readColorToken('--text-primary'),
                bodyColor: colorTokenWithAlpha('--text-rgb', 0.7),
                borderWidth: 0,
                cornerRadius: 4,
                displayColors: false,
                padding: 8,
                titleFont: { size: 11, weight: '600' },
                bodyFont: { size: 11 }
            }
        }
    };
}

// Metric identity RGB values for gradient fills
const METRIC_FILL_COLORS = {
    get utilization() { return readColorToken('--metric-util'); },
    get temperature() { return readColorToken('--metric-temp'); },
    get memory() { return readColorToken('--metric-mem'); },
    get power() { return readColorToken('--metric-power'); },
    get fanSpeed() { return readColorToken('--metric-fan'); },
    get clocks() { return readColorToken('--metric-clocks'); },
    get efficiency() { return readColorToken('--metric-efficiency'); },
    get pcie() { return readColorToken('--metric-pcie'); },
    get appclocks() { return readColorToken('--metric-clocks'); },
    get encoderDecoder() { return readColorToken('--metric-encoder-decoder'); },
    get systemCpu() { return readColorToken('--neutral-rgb'); },
    get systemMemory() { return readColorToken('--neutral-rgb'); },
    get systemSwap() { return readColorToken('--neutral-rgb'); },
    get systemNetIo() { return readColorToken('--neutral-rgb'); },
    get systemDiskIo() { return readColorToken('--neutral-rgb'); },
    get systemLoadAvg() { return readColorToken('--neutral-rgb'); },
};

// Single-line sparkline config
function createLineChartConfig(options) {
    const {
        label,
        yMax,
        yStepSize,
        yUnit,
        tooltipTitle,
        tooltipLabel,
        decimals = 1
    } = options;

    const config = {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: label,
                data: [],
                borderColor: SPARK.stroke,
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                tension: 0.3,
                fill: true,
                pointRadius: 0,
                pointHitRadius: 8
            }]
        },
        options: getBaseChartOptions()
    };

    if (yMax !== undefined) config.options.scales.y.max = yMax;
    if (options.ySuggestedMax) config.options.scales.y.suggestedMax = options.ySuggestedMax;
    if (yStepSize) config.options.scales.y.ticks.stepSize = yStepSize;
    if (yUnit) {
        config.options.scales.y.ticks.callback = function (value) {
            return value + yUnit;
        };
    }

    config.options.plugins.tooltip.callbacks = {
        title: function () { return tooltipTitle; },
        label: function (context) {
            const displayLabel = tooltipLabel || context.dataset.label || '';
            const value = context.parsed.y;
            return `${displayLabel}: ${value.toFixed(decimals)}${yUnit || ''}`;
        }
    };

    return config;
}

// Multi-line sparkline config
function createMultiLineChartConfig(options) {
    const {
        datasets,
        yUnit,
        tooltipTitle,
        showLegend = false,
        ySuggestedMax,
        decimals = 0
    } = options;

    // Grayscale tones for multi-line differentiation
    const grayTones = [
        SPARK.stroke,
        SPARK.strokeLight,
        SPARK.strokeDim,
        colorTokenWithAlpha('--neutral-rgb', 0.1)
    ];

    const config = {
        type: 'line',
        data: {
            labels: [],
            datasets: datasets.map((ds, i) => ({
                label: ds.label,
                data: [],
                borderColor: grayTones[i % grayTones.length],
                backgroundColor: 'transparent',
                borderWidth: ds.width || 1.5,
                tension: 0.3,
                fill: false,
                pointRadius: 0,
                pointHitRadius: 8
            }))
        },
        options: getBaseChartOptions()
    };

    if (ySuggestedMax) config.options.scales.y.suggestedMax = ySuggestedMax;
    if (yUnit) {
        config.options.scales.y.ticks.callback = function (value) {
            return value.toFixed(decimals) + yUnit;
        };
    }

    if (showLegend) {
        config.options.plugins.legend.display = true;
        config.options.plugins.legend.position = 'top';
        config.options.plugins.legend.align = 'end';
        config.options.plugins.legend.labels = {
            color: colorTokenWithAlpha('--neutral-rgb', 0.5),
            font: { size: 10 },
            boxWidth: 8,
            boxHeight: 2,
            padding: 8,
            usePointStyle: false
        };
    }

    config.options.plugins.tooltip.callbacks = {
        title: function () { return tooltipTitle; },
        label: function (context) {
            const label = context.dataset.label || '';
            const value = context.parsed.y;
            return `${label}: ${value.toFixed(decimals)}${yUnit || ''}`;
        }
    };

    return config;
}

function chartConfigWithCurrentColors(sourceConfig) {
    const chartConfig = JSON.parse(JSON.stringify(sourceConfig));
    const lineColors = [
        SPARK.stroke,
        SPARK.strokeLight,
        SPARK.strokeDim,
        colorTokenWithAlpha('--neutral-rgb', 0.1)
    ];
    chartConfig.data.datasets.forEach((dataset, index) => {
        dataset.borderColor = chartConfig.data.datasets.length === 1
            ? SPARK.stroke
            : lineColors[index % lineColors.length];
    });
    const yScale = chartConfig.options.scales.y;
    if (yScale?.grid) yScale.grid.color = SPARK.grid;
    if (yScale?.ticks) yScale.ticks.color = SPARK.tick;
    const tooltip = chartConfig.options.plugins.tooltip;
    tooltip.backgroundColor = SPARK.tooltipBg;
    tooltip.titleColor = readColorToken('--text-primary');
    tooltip.bodyColor = colorTokenWithAlpha('--text-rgb', 0.7);
    const legendLabels = chartConfig.options.plugins.legend.labels;
    if (legendLabels) legendLabels.color = colorTokenWithAlpha('--neutral-rgb', 0.5);
    return chartConfig;
}

// ============================================
// Chart Configs — all grayscale sparklines
// ============================================

const chartConfigs = {
    utilization: createLineChartConfig({
        label: 'Utilization',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'GPU Utilization',
        tooltipLabel: 'Util'
    }),

    temperature: createLineChartConfig({
        label: 'Temperature',
        ySuggestedMax: 90,
        yStepSize: 30,
        yUnit: '°C',
        tooltipTitle: 'Temperature',
        tooltipLabel: 'Temp'
    }),

    memory: createLineChartConfig({
        label: 'Memory',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'VRAM Usage',
        tooltipLabel: 'Mem'
    }),

    power: createLineChartConfig({
        label: 'Power',
        ySuggestedMax: 200,
        yStepSize: 100,
        yUnit: 'W',
        tooltipTitle: 'Power Draw',
        tooltipLabel: 'Power'
    }),

    fanSpeed: createLineChartConfig({
        label: 'Fan',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'Fan Speed',
        tooltipLabel: 'Fan'
    }),

    clocks: createMultiLineChartConfig({
        datasets: [
            { label: 'Graphics' },
            { label: 'SM' },
            { label: 'Memory' }
        ],
        yUnit: ' MHz',
        tooltipTitle: 'Clock Speeds',
        showLegend: true,
        decimals: 0
    }),

    efficiency: createLineChartConfig({
        label: 'Efficiency',
        yUnit: ' %/W',
        tooltipTitle: 'Power Efficiency',
        tooltipLabel: 'Eff',
        decimals: 2
    }),

    pcie: createMultiLineChartConfig({
        datasets: [
            { label: 'RX' },
            { label: 'TX' }
        ],
        yUnit: ' KB/s',
        tooltipTitle: 'PCIe Throughput',
        showLegend: true,
        decimals: 0
    }),

    appclocks: createMultiLineChartConfig({
        datasets: [
            { label: 'Graphics' },
            { label: 'Memory' },
            { label: 'SM' },
            { label: 'Video' }
        ],
        yUnit: ' MHz',
        tooltipTitle: 'App Clocks',
        showLegend: true,
        decimals: 0
    }),

    encoderDecoder: createMultiLineChartConfig({
        datasets: [
            { label: 'Encoder' },
            { label: 'Decoder' }
        ],
        yUnit: '%',
        tooltipTitle: 'Encoder / Decoder Utilization',
        showLegend: true,
        ySuggestedMax: 100,
        decimals: 0
    }),

    // ============================================
    // System Charts
    // ============================================

    systemCpu: createLineChartConfig({
        label: 'CPU',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'CPU Usage',
        tooltipLabel: 'CPU'
    }),

    systemMemory: createLineChartConfig({
        label: 'RAM',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'RAM Usage',
        tooltipLabel: 'RAM'
    }),

    systemSwap: createLineChartConfig({
        label: 'Swap',
        yMax: 100,
        yStepSize: 50,
        yUnit: '%',
        tooltipTitle: 'Swap Usage',
        tooltipLabel: 'Swap'
    }),

    systemNetIo: createMultiLineChartConfig({
        datasets: [
            { label: 'RX' },
            { label: 'TX' }
        ],
        yUnit: ' KB/s',
        tooltipTitle: 'Network I/O',
        showLegend: true,
        decimals: 1
    }),

    systemDiskIo: createMultiLineChartConfig({
        datasets: [
            { label: 'Read' },
            { label: 'Write' }
        ],
        yUnit: ' KB/s',
        tooltipTitle: 'Disk I/O',
        showLegend: true,
        decimals: 1
    }),

    systemLoadAvg: createMultiLineChartConfig({
        datasets: [
            { label: '1m' },
            { label: '5m' },
            { label: '15m' }
        ],
        yUnit: '',
        tooltipTitle: 'Load Average',
        showLegend: true,
        ySuggestedMax: 4,
        decimals: 2
    })
};
