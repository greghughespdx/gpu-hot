/**
 * Tests for static/js/chart-config.js
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(__dirname, '../../static');

// Globals loaded by setup.js: SPARK, SPARK_THRESHOLDS, chartConfigs, getBaseChartOptions,
// createLineChartConfig, createMultiLineChartConfig

describe('SPARK constants', () => {
    it('defines stroke color', () => {
        expect(SPARK.stroke).toBeDefined();
        expect(typeof SPARK.stroke).toBe('string');
    });

    it('defines warning color', () => {
        expect(SPARK.warning).toBe('#f5a623');
    });

    it('defines tooltip background', () => {
        expect(SPARK.tooltipBg).toBe('#171b22');
    });
});

describe('CSS color tokens', () => {
    it.each([
        ['--text-rgb', '238, 240, 244'],
        ['--neutral-rgb', '255, 255, 255'],
        ['--shadow-rgb', '0, 0, 0'],
        ['--metric-encoder-decoder', '0, 210, 190'],
        ['--companion-rgb', '255, 170, 50'],
        ['--toast-text', 'rgba(255, 200, 100, 0.9)'],
        ['--toast-text-hover', 'rgba(255, 210, 130, 1)']
    ])('preserves the existing palette value for %s', (token, expected) => {
        expect(readColorToken(token)).toBe(expected);
    });

    it('resolves chart colors from the current computed style', () => {
        document.documentElement.style.setProperty('--warning', '#123456');
        document.documentElement.style.setProperty('--neutral-rgb', '1, 2, 3');

        expect(SPARK.warning).toBe('#123456');
        expect(SPARK.stroke).toBe('rgba(1, 2, 3, 0.6)');

        document.documentElement.style.removeProperty('--warning');
        document.documentElement.style.removeProperty('--neutral-rgb');
    });

    it('refreshes a chart config from computed tokens before drawing', () => {
        document.documentElement.style.setProperty('--neutral-rgb', '9, 8, 7');

        const config = chartConfigWithCurrentColors(chartConfigs.utilization);

        expect(config.data.datasets[0].borderColor).toBe('rgba(9, 8, 7, 0.6)');
        expect(config.options.scales.y.grid.color).toBe('rgba(9, 8, 7, 0.04)');
        document.documentElement.style.removeProperty('--neutral-rgb');
    });

    it('keeps numeric color literals in the token file only', () => {
        const componentCss = readFileSync(join(staticRoot, 'css/components.css'), 'utf-8');
        const javascript = readdirSync(join(staticRoot, 'js'))
            .filter(name => name.endsWith('.js'))
            .map(name => readFileSync(join(staticRoot, 'js', name), 'utf-8'))
            .join('\n');
        const numericColor = /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i;

        expect(componentCss).not.toMatch(numericColor);
        expect(javascript).not.toMatch(numericColor);
    });

    it('defines every color token referenced by components and charts', () => {
        const tokenCss = readFileSync(join(staticRoot, 'css/tokens.css'), 'utf-8');
        const componentCss = readFileSync(join(staticRoot, 'css/components.css'), 'utf-8');
        const chartJavascript = ['chart-config.js', 'chart-manager.js', 'chart-drawer.js', 'socket-handlers.js']
            .map(name => readFileSync(join(staticRoot, 'js', name), 'utf-8'))
            .join('\n');
        const definitions = new Set(Array.from(tokenCss.matchAll(/(--[\w-]+)\s*:/g), match => match[1]));
        const references = new Set([
            ...Array.from(componentCss.matchAll(/var\((--[\w-]+)/g), match => match[1]),
            ...Array.from(
                chartJavascript.matchAll(/(?:readColorToken|colorTokenWithAlpha)\('(\-\-[\w-]+)'/g),
                match => match[1]
            )
        ]);

        expect([...references].filter(token => !definitions.has(token))).toEqual([]);
    });
});

describe('SPARK_THRESHOLDS', () => {
    it('defines utilization threshold', () => {
        expect(SPARK_THRESHOLDS.utilization).toBe(80);
    });

    it('defines temperature threshold', () => {
        expect(SPARK_THRESHOLDS.temperature).toBe(75);
    });

    it('defines memory threshold', () => {
        expect(SPARK_THRESHOLDS.memory).toBe(85);
    });
});

describe('getBaseChartOptions', () => {
    it('returns responsive options', () => {
        const opts = getBaseChartOptions();
        expect(opts.responsive).toBe(true);
        expect(opts.animation).toBe(false);
    });

    it('disables x-axis display', () => {
        const opts = getBaseChartOptions();
        expect(opts.scales.x.display).toBe(false);
    });

    it('sets point radius to zero', () => {
        const opts = getBaseChartOptions();
        expect(opts.elements.point.radius).toBe(0);
    });
});

describe('chartConfigs', () => {
    const expectedTypes = [
        'utilization', 'temperature', 'memory', 'power',
        'fanSpeed', 'clocks', 'efficiency', 'pcie',
        'appclocks', 'encoderDecoder',
        'systemCpu', 'systemMemory', 'systemSwap',
        'systemNetIo', 'systemDiskIo', 'systemLoadAvg'
    ];

    for (const type of expectedTypes) {
        it(`defines config for ${type}`, () => {
            expect(chartConfigs[type]).toBeDefined();
            expect(chartConfigs[type].type).toBe('line');
            expect(chartConfigs[type].data).toBeDefined();
            expect(chartConfigs[type].data.datasets.length).toBeGreaterThan(0);
        });
    }

    it('utilization has yMax of 100', () => {
        const yScale = chartConfigs.utilization.options.scales.y;
        expect(yScale.max).toBe(100);
    });
});
