"""Tests for core/nvidia_smi_fallback.py"""

import json
import subprocess
from pathlib import Path

import pytest
from unittest.mock import patch, MagicMock

from core.external_fans import create_external_fan_reader
from core.nvidia_smi_fallback import parse_nvidia_smi, parse_nvidia_smi_fallback


# Realistic CSV output for comprehensive query (31 fields)
FULL_CSV = (
    "0, NVIDIA GeForce RTX 3090, GPU-abc-1234, 535.129.03, 94.02.42.00.A1, "
    "72, 75, 45, 8192, 24576, 16384, 250.00, 350.00, "
    "65, 1800, 1800, 5001, "
    "2100, 2100, 5505, "
    "4, 4, 16, 16, "
    "0, 0.0, 0.0, "
    "P0, Default, "
    "0, 0, "
    "00000000:19:00.0"
)

# Realistic CSV output for basic query (14 fields)
BASIC_CSV = (
    "0, NVIDIA GeForce RTX 3090, 72, 75, 45, "
    "8192, 24576, 250.00, 350.00, 65, "
    "1800, 1800, 5001, P0, 00000000:19:00.0"
)

# The fan channel that cools the passive card at 0000:19:00.0 on the fixture
# controller: 3705 RPM at PWM 145.
HWMON_ROOT = (
    Path(__file__).parents[1] / "fixtures" / "external_fans" / "sys" / "class" / "hwmon"
)
MAPPED_CARD = "0000:19:00.0"
CHANNEL_ONE_PERCENT = round(145 / 255 * 100, 1)

FULL_FAN_FIELD = 13
BASIC_FAN_FIELD = 9


def _with_field(csv, index, value):
    """Return the CSV line with one field replaced."""
    parts = [part.strip() for part in csv.split(',')]
    parts[index] = value
    return ", ".join(parts)


def _mapping(**overrides):
    entry = {"source": "hwmon", "name": "arctic_fan", "channel": 1}
    entry.update(overrides)
    return json.dumps({MAPPED_CARD: entry})


def _make_result(stdout, returncode=0):
    result = MagicMock()
    result.returncode = returncode
    result.stdout = stdout
    return result


class TestParseNvidiaSmi:
    @patch('subprocess.run')
    def test_success_single_gpu(self, mock_run):
        mock_run.return_value = _make_result(FULL_CSV + "\n")
        data = parse_nvidia_smi()

        assert '0' in data
        gpu = data['0']
        assert gpu['name'] == 'NVIDIA GeForce RTX 3090'
        assert gpu['temperature'] == 72.0
        assert gpu['utilization'] == 75.0
        assert gpu['memory_used'] == 8192.0
        assert gpu['memory_total'] == 24576.0
        assert gpu['power_draw'] == 250.0
        assert gpu['power_limit'] == 350.0
        assert gpu['fan_speed'] == 65.0
        assert gpu['clock_graphics'] == 1800.0
        assert gpu['performance_state'] == 'P0'

    @patch('subprocess.run')
    def test_multi_gpu(self, mock_run):
        gpu0 = FULL_CSV
        gpu1 = FULL_CSV.replace("0, NVIDIA", "1, NVIDIA", 1)
        mock_run.return_value = _make_result(gpu0 + "\n" + gpu1 + "\n")
        data = parse_nvidia_smi()

        assert '0' in data
        assert '1' in data

    @patch('subprocess.run')
    def test_na_values(self, mock_run):
        csv = FULL_CSV.replace("72", "[N/A]").replace("75", "N/A")
        mock_run.return_value = _make_result(csv + "\n")
        data = parse_nvidia_smi()

        gpu = data['0']
        assert gpu['temperature'] == 0  # [N/A] -> 0
        assert gpu['utilization'] == 0  # N/A -> 0

    @patch('subprocess.run')
    def test_fallback_mode_flag(self, mock_run):
        mock_run.return_value = _make_result(FULL_CSV + "\n")
        data = parse_nvidia_smi()
        assert data['0']['_fallback_mode'] is True

    @patch('subprocess.run')
    def test_timestamp_present(self, mock_run):
        mock_run.return_value = _make_result(FULL_CSV + "\n")
        data = parse_nvidia_smi()
        assert 'timestamp' in data['0']

    @patch('subprocess.run')
    def test_failure_falls_back(self, mock_run):
        # First call fails (comprehensive query), second call succeeds (basic)
        mock_run.side_effect = [
            _make_result("", returncode=1),
            _make_result(BASIC_CSV + "\n")
        ]
        data = parse_nvidia_smi()
        assert '0' in data
        assert data['0']['name'] == 'NVIDIA GeForce RTX 3090'

    @patch('subprocess.run')
    def test_timeout(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd='nvidia-smi', timeout=10)
        data = parse_nvidia_smi()
        assert data == {}

    @patch('subprocess.run')
    def test_exception_falls_back(self, mock_run):
        # First call raises, second (fallback) succeeds
        mock_run.side_effect = [
            Exception("weird error"),
            _make_result(BASIC_CSV + "\n")
        ]
        data = parse_nvidia_smi()
        assert '0' in data

    @patch('subprocess.run')
    def test_empty_output(self, mock_run):
        mock_run.return_value = _make_result("")
        data = parse_nvidia_smi()
        assert data == {}


class TestParseNvidiaSmiBasicFallback:
    @patch('subprocess.run')
    def test_success(self, mock_run):
        mock_run.return_value = _make_result(BASIC_CSV + "\n")
        data = parse_nvidia_smi_fallback()

        assert '0' in data
        gpu = data['0']
        assert gpu['name'] == 'NVIDIA GeForce RTX 3090'
        assert gpu['temperature'] == 72.0
        assert gpu['utilization'] == 75.0
        assert gpu['memory_used'] == 8192.0
        assert gpu['_fallback_mode'] is True
        # Basic query doesn't have UUID
        assert gpu['uuid'] == 'N/A'

    @patch('subprocess.run')
    def test_failure(self, mock_run):
        mock_run.return_value = _make_result("", returncode=1)
        data = parse_nvidia_smi_fallback()
        assert data == {}

    @patch('subprocess.run')
    def test_exception(self, mock_run):
        mock_run.side_effect = Exception("fail")
        data = parse_nvidia_smi_fallback()
        assert data == {}

    @patch('subprocess.run')
    def test_memory_free_calculated(self, mock_run):
        mock_run.return_value = _make_result(BASIC_CSV + "\n")
        data = parse_nvidia_smi_fallback()
        gpu = data['0']
        assert gpu['memory_free'] == gpu['memory_total'] - gpu['memory_used']


class TestPCIAddressAndFanAvailability:
    """The external fan mapping is keyed by PCI address and needs to know
    whether a card reports a fan at all, so both have to survive this path."""

    @patch('subprocess.run')
    def test_both_queries_ask_for_the_pci_address(self, mock_run):
        mock_run.return_value = _make_result(FULL_CSV + "\n")
        parse_nvidia_smi()
        assert 'pci.bus_id' in " ".join(mock_run.call_args[0][0])

        mock_run.return_value = _make_result(BASIC_CSV + "\n")
        parse_nvidia_smi_fallback()
        assert 'pci.bus_id' in " ".join(mock_run.call_args[0][0])

    @patch('subprocess.run')
    def test_comprehensive_query_carries_a_normalised_address(self, mock_run):
        mock_run.return_value = _make_result(FULL_CSV + "\n")
        assert parse_nvidia_smi()['0']['pci_bus_id'] == MAPPED_CARD

    @patch('subprocess.run')
    def test_basic_query_carries_a_normalised_address(self, mock_run):
        mock_run.return_value = _make_result(BASIC_CSV + "\n")
        assert parse_nvidia_smi_fallback()['0']['pci_bus_id'] == MAPPED_CARD

    @pytest.mark.parametrize("reported", ['N/A', '[N/A]', '', 'not-a-pci-address', '19:00'])
    @patch('subprocess.run')
    def test_an_unusable_address_is_left_out(self, mock_run, reported):
        """Only a value the normalizer accepts becomes a mapping key; anything else is omitted, never stored raw."""
        mock_run.return_value = _make_result(_with_field(FULL_CSV, 31, reported) + "\n")
        assert 'pci_bus_id' not in parse_nvidia_smi()['0']

    @pytest.mark.parametrize("reported", ['N/A', '[N/A]', ''])
    @patch('subprocess.run')
    def test_comprehensive_unsupported_fan_is_absent_not_zero(self, mock_run, reported):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, reported)
        mock_run.return_value = _make_result(csv + "\n")
        assert 'fan_speed' not in parse_nvidia_smi()['0']

    @pytest.mark.parametrize("reported", ['N/A', '[N/A]', ''])
    @patch('subprocess.run')
    def test_basic_unsupported_fan_is_absent_not_zero(self, mock_run, reported):
        csv = _with_field(BASIC_CSV, BASIC_FAN_FIELD, reported)
        mock_run.return_value = _make_result(csv + "\n")
        assert 'fan_speed' not in parse_nvidia_smi_fallback()['0']

    @patch('subprocess.run')
    def test_comprehensive_real_zero_fan_stays_zero(self, mock_run):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, '0')
        mock_run.return_value = _make_result(csv + "\n")
        assert parse_nvidia_smi()['0']['fan_speed'] == 0.0

    @patch('subprocess.run')
    def test_basic_real_zero_fan_stays_zero(self, mock_run):
        csv = _with_field(BASIC_CSV, BASIC_FAN_FIELD, '0')
        mock_run.return_value = _make_result(csv + "\n")
        assert parse_nvidia_smi_fallback()['0']['fan_speed'] == 0.0


class TestExternalFanHandoff:
    """An nvidia-smi payload has to reach the fan mapping the same way an NVML
    one does: matched by PCI address, and covered only when no fan is reported."""

    @patch('subprocess.run')
    def test_comprehensive_payload_without_a_fan_gets_the_mapping(self, mock_run):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, 'N/A')
        mock_run.return_value = _make_result(csv + "\n")
        payloads = parse_nvidia_smi()

        create_external_fan_reader(_mapping(), HWMON_ROOT).apply(payloads)

        assert payloads['0']['fan_speed'] == CHANNEL_ONE_PERCENT
        assert payloads['0']['fan_rpm'] == 3705

    @patch('subprocess.run')
    def test_basic_payload_without_a_fan_gets_the_mapping(self, mock_run):
        csv = _with_field(BASIC_CSV, BASIC_FAN_FIELD, 'N/A')
        mock_run.return_value = _make_result(csv + "\n")
        payloads = parse_nvidia_smi_fallback()

        create_external_fan_reader(_mapping(), HWMON_ROOT).apply(payloads)

        assert payloads['0']['fan_speed'] == CHANNEL_ONE_PERCENT
        assert payloads['0']['fan_rpm'] == 3705

    @patch('subprocess.run')
    def test_a_fan_reporting_zero_percent_is_left_alone(self, mock_run):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, '0')
        mock_run.return_value = _make_result(csv + "\n")
        payloads = parse_nvidia_smi()

        create_external_fan_reader(_mapping(), HWMON_ROOT).apply(payloads)

        assert payloads['0']['fan_speed'] == 0.0
        assert 'fan_rpm' not in payloads['0']

    @patch('subprocess.run')
    def test_override_replaces_a_fan_reporting_zero_percent(self, mock_run):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, '0')
        mock_run.return_value = _make_result(csv + "\n")
        payloads = parse_nvidia_smi()

        create_external_fan_reader(_mapping(override=True), HWMON_ROOT).apply(payloads)

        assert payloads['0']['fan_speed'] == CHANNEL_ONE_PERCENT
        assert payloads['0']['fan_rpm'] == 3705

    @patch('subprocess.run')
    def test_an_unmapped_card_keeps_its_absent_fan(self, mock_run):
        csv = _with_field(FULL_CSV, FULL_FAN_FIELD, 'N/A')
        csv = _with_field(csv, 31, '00000000:b3:00.0')
        mock_run.return_value = _make_result(csv + "\n")
        payloads = parse_nvidia_smi()

        create_external_fan_reader(_mapping(), HWMON_ROOT).apply(payloads)

        assert 'fan_speed' not in payloads['0']
        assert 'fan_rpm' not in payloads['0']
