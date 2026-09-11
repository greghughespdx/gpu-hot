"""Tests for the optional external fan mapping."""

import json
import logging
from pathlib import Path

import pytest

from core.external_fans import (
    ExternalFanReader,
    ExternalFanSource,
    create_external_fan_reader,
    normalise_pci_address,
    parse_external_fans,
)


HWMON_ROOT = (
    Path(__file__).parents[1] / "fixtures" / "external_fans" / "sys" / "class" / "hwmon"
)
CONTROLLER = HWMON_ROOT / "hwmon2"

CARD_ONE = "0000:19:00.0"
CARD_TWO = "0000:67:00.0"

# Channel 1 reads 3705 RPM at PWM 145, channel 2 3441 RPM at PWM 139.
CHANNEL_ONE_PERCENT = round(145 / 255 * 100, 1)
CHANNEL_TWO_PERCENT = round(139 / 255 * 100, 1)


def _config(**overrides):
    entry = {"source": "hwmon", "name": "arctic_fan", "channel": 1}
    entry.update(overrides)
    return json.dumps({CARD_ONE: entry})


def _reader(raw, hwmon_root=HWMON_ROOT):
    return create_external_fan_reader(raw, hwmon_root)


class TestPCIAddressNormalisation:
    @pytest.mark.parametrize(
        "address",
        ["0000:19:00.0", "00000000:19:00.0", "19:00.0", "0000:19:00.0 ", "0000:19:00.0"],
    )
    def test_accepted_forms_normalise_to_one_shape(self, address):
        assert normalise_pci_address(address) == CARD_ONE

    def test_nvml_uppercase_domain_is_accepted(self):
        assert normalise_pci_address("00000000:67:00.0") == CARD_TWO
        assert normalise_pci_address("0000:B3:00.0") == "0000:b3:00.0"

    @pytest.mark.parametrize(
        "address",
        [None, 42, "", "not-an-address", "0000:19:00", "0000:19:00.8", "zzzz:19:00.0"],
    )
    def test_unusable_values_are_rejected(self, address):
        assert normalise_pci_address(address) is None


class TestConfigParsing:
    def test_empty_config_is_off(self):
        assert parse_external_fans("") == {}
        assert parse_external_fans(None) == {}
        assert parse_external_fans("   ") == {}

    def test_full_entry_is_parsed(self):
        mapping = parse_external_fans(
            json.dumps(
                {
                    CARD_ONE: {"source": "hwmon", "name": "arctic_fan", "channel": 1},
                    CARD_TWO: {
                        "source": "hwmon",
                        "path": "/sys/class/hwmon/hwmon2",
                        "channel": 2,
                        "override": True,
                    },
                }
            )
        )
        assert mapping[CARD_ONE] == ExternalFanSource(
            kind="hwmon", channel=1, name="arctic_fan"
        )
        assert mapping[CARD_TWO] == ExternalFanSource(
            kind="hwmon",
            channel=2,
            path=Path("/sys/class/hwmon/hwmon2"),
            override=True,
        )

    def test_source_defaults_to_hwmon(self):
        mapping = parse_external_fans(
            json.dumps({CARD_ONE: {"name": "arctic_fan", "channel": 1}})
        )
        assert mapping[CARD_ONE].kind == "hwmon"

    def test_string_channel_is_accepted(self):
        mapping = parse_external_fans(
            json.dumps({CARD_ONE: {"name": "arctic_fan", "channel": "2"}})
        )
        assert mapping[CARD_ONE].channel == 2

    def test_invalid_json_is_ignored_and_logged(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert parse_external_fans("{not json") == {}
        assert "not valid JSON" in caplog.text

    def test_non_object_document_is_ignored_and_logged(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert parse_external_fans('["0000:19:00.0"]') == {}
        assert "object of PCI address" in caplog.text

    @pytest.mark.parametrize(
        ("document", "expected_log"),
        [
            ({"nonsense": {"name": "arctic_fan", "channel": 1}}, "unusable PCI address"),
            ({CARD_ONE: "arctic_fan"}, "is not an object"),
            ({CARD_ONE: {"name": "arctic_fan"}}, "positive integer channel"),
            ({CARD_ONE: {"name": "arctic_fan", "channel": 0}}, "positive integer channel"),
            (
                {CARD_ONE: {"name": "arctic_fan", "channel": "one"}},
                "positive integer channel",
            ),
            ({CARD_ONE: {"channel": 1}}, "needs an hwmon path or name"),
            (
                {CARD_ONE: {"source": "ipmi", "name": "x", "channel": 1}},
                "unknown source",
            ),
        ],
    )
    def test_a_bad_entry_is_dropped_and_logged(self, document, expected_log, caplog):
        with caplog.at_level(logging.WARNING):
            assert parse_external_fans(json.dumps(document)) == {}
        assert expected_log in caplog.text

    def test_reserved_file_source_is_not_implemented_yet(self, caplog):
        document = {CARD_ONE: {"source": "file", "path": "/run/fans.json", "channel": 1}}
        with caplog.at_level(logging.WARNING):
            assert parse_external_fans(json.dumps(document)) == {}
        assert "not implemented yet" in caplog.text

    def test_a_bad_entry_does_not_drop_the_good_ones(self, caplog):
        document = {
            CARD_ONE: {"name": "arctic_fan", "channel": 1},
            CARD_TWO: {"name": "arctic_fan"},
        }
        with caplog.at_level(logging.WARNING):
            mapping = parse_external_fans(json.dumps(document))
        assert list(mapping) == [CARD_ONE]
        assert "positive integer channel" in caplog.text


class TestResolution:
    def test_resolves_by_hwmon_name_past_other_devices(self):
        reader = _reader(_config(name="arctic_fan", channel=1))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == CHANNEL_ONE_PERCENT
        assert payloads["0"]["fan_rpm"] == 3705

    def test_resolves_by_explicit_path(self):
        reader = _reader(_config(path=str(CONTROLLER), channel=2))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == CHANNEL_TWO_PERCENT
        assert payloads["0"]["fan_rpm"] == 3441

    def test_unknown_hwmon_name_adds_nothing(self, caplog):
        reader = _reader(_config(name="no_such_controller"))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        with caplog.at_level(logging.DEBUG):
            reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]
        assert "fan_rpm" not in payloads["0"]
        assert "is not present" in caplog.text

    def test_missing_path_adds_nothing(self, tmp_path):
        reader = _reader(_config(path=str(tmp_path / "absent")))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]

    def test_missing_channel_files_add_nothing(self, caplog):
        reader = _reader(_config(channel=99))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        with caplog.at_level(logging.DEBUG):
            reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]
        assert "fan_rpm" not in payloads["0"]
        assert "no readable value" in caplog.text

    def test_unreadable_file_adds_nothing(self, tmp_path, caplog):
        controller = tmp_path / "hwmon0"
        controller.mkdir()
        (controller / "name").write_text("chassis_fan\n")
        (controller / "pwm1").write_text("nonsense\n")
        (controller / "fan1_input").write_text("also nonsense\n")
        reader = _reader(_config(path=str(controller)))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        with caplog.at_level(logging.DEBUG):
            reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]
        assert "fan_rpm" not in payloads["0"]
        assert "not a number" in caplog.text

    def test_absent_pwm_omits_percent_but_keeps_rpm(self, tmp_path):
        controller = tmp_path / "hwmon0"
        controller.mkdir()
        (controller / "name").write_text("chassis_fan\n")
        (controller / "fan1_input").write_text("4200\n")
        reader = _reader(_config(path=str(controller)))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]
        assert payloads["0"]["fan_rpm"] == 4200

    def test_absent_tachometer_keeps_percent(self, tmp_path):
        controller = tmp_path / "hwmon0"
        controller.mkdir()
        (controller / "name").write_text("chassis_fan\n")
        (controller / "pwm1").write_text("255\n")
        reader = _reader(_config(path=str(controller)))
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == 100.0
        assert "fan_rpm" not in payloads["0"]

    def test_name_resolution_is_reused_then_rechecked(self, tmp_path):
        controller = tmp_path / "hwmon0"
        controller.mkdir()
        (controller / "name").write_text("chassis_fan\n")
        (controller / "pwm1").write_text("128\n")
        reader = ExternalFanReader(
            {CARD_ONE: ExternalFanSource(kind="hwmon", channel=1, name="chassis_fan")},
            tmp_path,
        )
        payloads = {"0": {"pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == round(128 / 255 * 100, 1)

        # The controller moves to a different hwmon number, as it can after a
        # re-enumeration. The cached directory no longer answers to the name.
        (controller / "name").write_text("something_else\n")
        moved = tmp_path / "hwmon7"
        moved.mkdir()
        (moved / "name").write_text("chassis_fan\n")
        (moved / "pwm1").write_text("255\n")
        second = {"1": {"pci_bus_id": CARD_ONE}}
        reader.apply(second)
        assert second["1"]["fan_speed"] == 100.0


class TestAmbiguousNames:
    @staticmethod
    def _controller(directory, name, pwm):
        directory.mkdir()
        (directory / "name").write_text(name + "\n")
        (directory / "pwm1").write_text(pwm + "\n")
        (directory / "fan1_input").write_text("3000\n")
        return directory

    def _two_controllers_named_the_same(self, tmp_path):
        self._controller(tmp_path / "hwmon0", "chassis_fan", "128")
        self._controller(tmp_path / "hwmon5", "chassis_fan", "255")

    def test_two_devices_with_one_name_report_nothing(self, tmp_path, caplog):
        self._two_controllers_named_the_same(tmp_path)
        reader = _reader(_config(name="chassis_fan"), tmp_path)
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        with caplog.at_level(logging.WARNING):
            reader.apply(payloads)
        assert "fan_speed" not in payloads["0"]
        assert "fan_rpm" not in payloads["0"]
        assert "matches 2 devices" in caplog.text

    def test_the_ambiguity_is_reported_once_not_every_poll(self, tmp_path, caplog):
        self._two_controllers_named_the_same(tmp_path)
        reader = _reader(_config(name="chassis_fan"), tmp_path)
        with caplog.at_level(logging.WARNING):
            for _ in range(3):
                reader.apply({"0": {"pci_bus_id": CARD_ONE}})
        assert caplog.text.count("matches 2 devices") == 1

    def test_an_explicit_path_is_the_way_past_an_ambiguous_name(self, tmp_path):
        self._two_controllers_named_the_same(tmp_path)
        reader = _reader(_config(path=str(tmp_path / "hwmon5")), tmp_path)
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == 100.0
        assert payloads["0"]["fan_rpm"] == 3000

    def test_a_duplicate_appearing_later_is_not_served_from_cache(self, tmp_path):
        self._controller(tmp_path / "hwmon0", "chassis_fan", "128")
        reader = _reader(_config(name="chassis_fan"), tmp_path)
        first = {"0": {"pci_bus_id": CARD_ONE}}
        reader.apply(first)
        assert first["0"]["fan_speed"] == round(128 / 255 * 100, 1)

        # The cached device is renamed and two others answer to the name.
        (tmp_path / "hwmon0" / "name").write_text("something_else\n")
        self._controller(tmp_path / "hwmon5", "chassis_fan", "255")
        self._controller(tmp_path / "hwmon6", "chassis_fan", "64")
        second = {"1": {"pci_bus_id": CARD_ONE}}
        reader.apply(second)
        assert "fan_speed" not in second["1"]


class TestApplication:
    def test_unmapped_gpu_is_untouched(self):
        reader = _reader(_config())
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_TWO}}
        reader.apply(payloads)
        assert payloads == {"0": {"vendor": "amd", "pci_bus_id": CARD_TWO}}

    def test_gpu_without_a_pci_address_is_untouched(self):
        reader = _reader(_config())
        payloads = {"0": {"vendor": "amd"}}
        reader.apply(payloads)
        assert payloads == {"0": {"vendor": "amd"}}

    def test_empty_config_changes_nothing(self):
        reader = _reader("")
        payloads = {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        reader.apply(payloads)
        assert payloads == {"0": {"vendor": "amd", "pci_bus_id": CARD_ONE}}
        assert not reader

    def test_nvidia_card_without_a_fan_gets_the_mapping(self):
        reader = _reader(_config())
        payloads = {"0": {"vendor": "nvidia", "pci_bus_id": "00000000:19:00.0"}}
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == CHANNEL_ONE_PERCENT
        assert payloads["0"]["fan_rpm"] == 3705

    def test_nvidia_card_with_its_own_fan_keeps_it(self):
        reader = _reader(_config())
        payloads = {
            "0": {"vendor": "nvidia", "pci_bus_id": CARD_ONE, "fan_speed": 65.0}
        }
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == 65.0
        assert "fan_rpm" not in payloads["0"]

    def test_override_replaces_a_reported_fan(self):
        reader = _reader(_config(override=True))
        payloads = {
            "0": {"vendor": "nvidia", "pci_bus_id": CARD_ONE, "fan_speed": 65.0}
        }
        reader.apply(payloads)
        assert payloads["0"]["fan_speed"] == CHANNEL_ONE_PERCENT
        assert payloads["0"]["fan_rpm"] == 3705

    def test_both_inf_cards_map_to_their_own_channel(self):
        reader = _reader(
            json.dumps(
                {
                    CARD_ONE: {"name": "arctic_fan", "channel": 1},
                    CARD_TWO: {"name": "arctic_fan", "channel": 2},
                }
            )
        )
        payloads = {
            "0": {"vendor": "amd", "pci_bus_id": CARD_ONE},
            "1": {"vendor": "amd", "pci_bus_id": CARD_TWO},
        }
        reader.apply(payloads)
        assert payloads["0"]["fan_rpm"] == 3705
        assert payloads["1"]["fan_rpm"] == 3441
        assert payloads["0"]["fan_speed"] == CHANNEL_ONE_PERCENT
        assert payloads["1"]["fan_speed"] == CHANNEL_TWO_PERCENT

    def test_a_failing_lookup_never_breaks_collection(self, caplog):
        class Exploding(dict):
            def get(self, key, default=None):
                raise OSError("sysfs went away")

        reader = _reader(_config())
        payloads = {"0": Exploding()}
        with caplog.at_level(logging.DEBUG):
            reader.apply(payloads)
        assert "External fan mapping failed" in caplog.text
