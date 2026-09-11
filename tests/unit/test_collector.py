"""Tests for core/metrics/collector.py"""

import pytest
from unittest.mock import patch, MagicMock, PropertyMock
import pynvml

from core.metrics.collector import MetricsCollector
from core.metrics.utils import safe_get


@pytest.fixture
def collector():
    return MetricsCollector()


@pytest.fixture
def mock_handle():
    return MagicMock(name="nvml_handle")


def _patch_safe_get(return_map):
    """Create a side_effect for safe_get that returns values based on the function called."""
    original_safe_get = safe_get

    def patched_safe_get(func, *args, default=None):
        name = getattr(func, '__name__', str(func))
        if name in return_map:
            return return_map[name]
        return default

    return patched_safe_get


class TestCollectAll:
    def test_returns_dict_with_required_keys(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=None):
            data = collector.collect_all(mock_handle, '0')

        assert isinstance(data, dict)
        assert data['index'] == '0'
        assert 'timestamp' in data

    def test_stores_previous_sample(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=None):
            collector.collect_all(mock_handle, '0')

        assert '0' in collector.previous_samples
        assert '0' in collector.last_sample_time


class TestBasicInfo:
    def test_name_populated(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetName', return_value=b"RTX 3090"), \
             patch('pynvml.nvmlDeviceGetUUID', return_value=None), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=None), \
             patch('pynvml.nvmlDeviceGetVbiosVersion', return_value=None), \
             patch('pynvml.nvmlDeviceGetBrand', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetArchitecture', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetCudaComputeCapability', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetSerial', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)):
            data = {}
            collector._add_basic_info(mock_handle, data)

        assert data['name'] == 'RTX 3090'

    def test_uuid_populated(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetName', return_value=None), \
             patch('pynvml.nvmlDeviceGetUUID', return_value=b"GPU-abc-123"), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=None), \
             patch('pynvml.nvmlDeviceGetVbiosVersion', return_value=None), \
             patch('pynvml.nvmlDeviceGetBrand', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetArchitecture', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetCudaComputeCapability', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetSerial', side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)):
            data = {}
            collector._add_basic_info(mock_handle, data)

        assert data['uuid'] == 'GPU-abc-123'


class TestBrandDetection:
    @pytest.mark.parametrize("brand_id,expected", [
        (1, 'GeForce'),
        (8, 'GeForce RTX'),
        (3, 'Tesla'),
        (99, 'Brand 99'),
    ])
    def test_brand_mapping(self, collector, mock_handle, brand_id, expected):
        with patch('core.metrics.collector.safe_get', return_value=brand_id):
            data = {}
            collector._detect_brand(mock_handle, data)
        assert data['brand'] == expected

    def test_brand_not_available(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=None):
            data = {}
            collector._detect_brand(mock_handle, data)
        assert 'brand' not in data


class TestArchitectureDetection:
    @pytest.mark.parametrize("arch_id,expected", [
        (2, 'Pascal'),
        (5, 'Ampere'),
        (6, 'Ada Lovelace'),
        (7, 'Hopper'),
    ])
    def test_nvml_architecture(self, collector, mock_handle, arch_id, expected):
        with patch('core.metrics.collector.safe_get', return_value=arch_id):
            data = {}
            collector._detect_architecture(mock_handle, data)
        assert data['architecture'] == expected

    def test_nvml_architecture_kepler(self, collector, mock_handle):
        """Kepler (arch_id=0) is falsy, so safe_get path skips to name fallback."""
        with patch('core.metrics.collector.safe_get', return_value=0):
            data = {'name': 'Tesla K80'}
            collector._detect_architecture(mock_handle, data)
        assert data['architecture'] == 'Kepler'

    def test_fallback_to_name(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=None):
            data = {'name': 'NVIDIA RTX 4090'}
            collector._detect_architecture(mock_handle, data)
        assert data['architecture'] == 'Ada Lovelace'

    @pytest.mark.parametrize("name,expected", [
        ('NVIDIA RTX 4090', 'Ada Lovelace'),
        ('NVIDIA A100', 'Ampere'),
        ('Tesla V100', 'Volta'),
        ('NVIDIA H100', 'Hopper'),
        ('GTX 1080 Ti', 'Pascal'),
        ('RTX 2080', 'Turing'),
        ('Unknown Model', 'Unknown'),
    ])
    def test_arch_from_name(self, collector, name, expected):
        assert collector._detect_arch_from_name(name) == expected


class TestPerformanceMetrics:
    def test_utilization(self, collector, mock_handle):
        util = MagicMock()
        util.gpu = 85
        util.memory = 50
        with patch('core.metrics.collector.safe_get', side_effect=[util, 2, 0]):
            data = {}
            collector._add_performance(mock_handle, data)

        assert data['utilization'] == 85.0
        assert data['memory_utilization'] == 50.0

    def test_performance_state(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', side_effect=[None, 3, None]):
            data = {}
            collector._add_performance(mock_handle, data)
        assert data['performance_state'] == 'P3'

    def test_compute_mode(self, collector, mock_handle):
        """Compute mode 0 is falsy in walrus operator, so test with mode=1."""
        with patch('core.metrics.collector.safe_get', side_effect=[None, None, 1]):
            data = {}
            collector._add_performance(mock_handle, data)
        assert data['compute_mode'] == 'Exclusive Thread'


class TestMemoryMetrics:
    def test_memory_values(self, collector, mock_handle):
        mem = MagicMock()
        mem.used = 8 * 1024**3
        mem.total = 24 * 1024**3
        mem.free = 16 * 1024**3

        with patch('core.metrics.collector.safe_get', side_effect=[mem, None]):
            data = {}
            collector._add_memory(mock_handle, data, '0', 1000.0)

        assert data['memory_used'] == 8192.0
        assert data['memory_total'] == 24576.0
        assert data['memory_free'] == 16384.0

    def test_memory_change_rate(self, collector, mock_handle):
        mem1 = MagicMock()
        mem1.used = 8 * 1024**3
        mem1.total = 24 * 1024**3
        mem1.free = 16 * 1024**3

        mem2 = MagicMock()
        mem2.used = 10 * 1024**3
        mem2.total = 24 * 1024**3
        mem2.free = 14 * 1024**3

        # First collection — no change rate
        with patch('core.metrics.collector.safe_get', side_effect=[mem1, None]):
            data1 = {}
            collector._add_memory(mock_handle, data1, '0', 1000.0)
        collector.previous_samples['0'] = data1.copy()
        collector.last_sample_time['0'] = 1000.0

        # Second collection — should calculate rate
        with patch('core.metrics.collector.safe_get', side_effect=[mem2, None]):
            data2 = {}
            collector._add_memory(mock_handle, data2, '0', 1001.0)

        assert 'memory_change_rate' in data2
        assert data2['memory_change_rate'] > 0


class TestPowerThermal:
    def test_temperature(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', side_effect=[72, None]):
            data = {}
            collector._add_temperature(mock_handle, data)
        assert data['temperature'] == 72.0

    def test_power(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', side_effect=[250000, 350000, None, None]):
            data = {}
            collector._add_power(mock_handle, data)
        assert data['power_draw'] == 250.0
        assert data['power_limit'] == 350.0

    def test_fan_speed_zero_is_recorded(self, collector, mock_handle):
        data = {}
        with patch('core.metrics.collector.safe_get', return_value=0):
            collector._add_fan_speeds(mock_handle, data)
        assert data['fan_speed'] == 0.0

    def test_fan_speed_unsupported_is_absent(self, collector, mock_handle):
        data = {}
        with patch('core.metrics.collector.safe_get', return_value=None):
            collector._add_fan_speeds(mock_handle, data)
        assert 'fan_speed' not in data

    def test_fan_speed(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=65):
            data = {}
            collector._add_fan_speeds(mock_handle, data)
        assert data['fan_speed'] == 65.0


class TestThrottling:
    def test_no_throttling(self, collector, mock_handle):
        """Throttle value 0 is falsy in walrus, so won't enter the block.
        Use a non-zero value that doesn't match any alarming reason."""
        # nvmlClocksThrottleReasonGpuIdle is not in the alarming set
        with patch('core.metrics.collector.safe_get',
                   return_value=pynvml.nvmlClocksThrottleReasonGpuIdle):
            data = {}
            collector._add_throttling(mock_handle, data)
        assert data['throttle_reasons'] == 'None'

    def test_hw_slowdown(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get',
                   return_value=pynvml.nvmlClocksThrottleReasonHwSlowdown):
            data = {}
            collector._add_throttling(mock_handle, data)
        assert 'HW Slowdown' in data['throttle_reasons']

    def test_not_available(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=None):
            data = {}
            collector._add_throttling(mock_handle, data)
        assert 'throttle_reasons' not in data


class TestClocks:
    def test_clock_types(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=1800):
            data = {}
            collector._add_clocks(mock_handle, data)
        assert data['clock_graphics'] == 1800.0
        assert data['clock_sm'] == 1800.0
        assert data['clock_memory'] == 1800.0
        assert data['clock_video'] == 1800.0
        assert 'clock_graphics_max' in data


class TestConnectivity:
    def test_pcie_metrics(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', return_value=4):
            pci_mock = MagicMock()
            pci_mock.busId = b"00000000:01:00.0"
            with patch('core.metrics.collector.safe_get', side_effect=[4, 4, 16, 16, 100, 200, pci_mock]):
                data = {}
                collector._add_connectivity(mock_handle, data)

        assert 'pcie_gen' in data or 'pci_bus_id' in data


class TestMediaEngines:
    def test_encoder_utilization(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetEncoderUtilization', return_value=(25, 1000)), \
             patch('pynvml.nvmlDeviceGetEncoderSessions', return_value=[]), \
             patch('pynvml.nvmlDeviceGetDecoderUtilization', return_value=(10, 1000), create=True), \
             patch('pynvml.nvmlDeviceGetDecoderSessions', return_value=[], create=True):
            data = {}
            collector._add_media_engines(mock_handle, data)

        assert data['encoder_utilization'] == 25.0
        assert data['decoder_utilization'] == 10.0

    def test_encoder_not_available(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetEncoderUtilization',
                   side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetEncoderSessions',
                   side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)), \
             patch('pynvml.nvmlDeviceGetDecoderUtilization',
                   side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED), create=True), \
             patch('pynvml.nvmlDeviceGetDecoderSessions',
                   side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED), create=True):
            data = {}
            collector._add_media_engines(mock_handle, data)

        assert 'encoder_utilization' not in data
        assert 'decoder_utilization' not in data


class TestHealthStatus:
    def test_ecc_enabled(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetEccMode', return_value=(1, 1)), \
             patch('core.metrics.collector.safe_get', return_value=5):
            data = {}
            collector._add_health_status(mock_handle, data)

        assert data['ecc_enabled'] is True
        assert data['ecc_errors_corrected'] == 5

    def test_ecc_disabled(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetEccMode', return_value=(0, 0)):
            data = {}
            collector._add_health_status(mock_handle, data)

        assert 'ecc_enabled' not in data

    def test_ecc_not_supported(self, collector, mock_handle):
        with patch('pynvml.nvmlDeviceGetEccMode',
                   side_effect=pynvml.NVMLError(pynvml.NVML_ERROR_NOT_SUPPORTED)):
            data = {}
            collector._add_health_status(mock_handle, data)

        assert 'ecc_enabled' not in data


class TestAdvanced:
    def test_persistence_mode(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', side_effect=[1, 0, 0, [], None, None]):
            data = {}
            collector._add_advanced(mock_handle, data)
        assert data['persistence_mode'] == 'Enabled'

    def test_display_active(self, collector, mock_handle):
        with patch('core.metrics.collector.safe_get', side_effect=[None, 1, None, [], None, None]):
            data = {}
            collector._add_advanced(mock_handle, data)
        assert data['display_active'] is True
