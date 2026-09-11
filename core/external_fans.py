"""Optional mapping from a GPU to a fan reported by a separate controller.

Passive server cards report no fan of their own: the fan that actually cools
them sits on a chassis or duct controller, and Linux exposes that controller
through hwmon. This module maps a GPU's PCI address to one of those channels
so the dashboard can show the fan that is doing the work.

The mapping is opt-in and off unless EXTERNAL_FANS is set. It is applied in
the shared metrics layer after a vendor collector has produced a GPU's
metrics, so it works for an AMD card with no fan node and for an NVIDIA card
whose driver reports no fan. A card that already reports its own fan keeps it
unless the entry asks for an override.

Nothing here raises: an unreadable or missing file yields no fan fields.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

HWMON_ROOT = Path("/sys/class/hwmon")
MAX_SYSFS_BYTES = 64
PWM_MAX = 255

# A mapping is a handful of cards, so a few kilobytes is already generous. The
# bound keeps an accidental or hostile value from being handed to the parser at
# all; whatever the parser then raises is contained separately, because deeply
# nested input reaches the interpreter's recursion limit long before this size.
MAX_CONFIG_CHARS = 8192

# Source kinds this module understands. "hwmon" reads a controller that the
# kernel already exposes. A "file" kind is reserved for a later phase: a JSON
# document published by another process, for hosts whose fans are driven over
# IPMI or a vendor agent rather than through hwmon. Parsing rejects it today.
SOURCE_HWMON = "hwmon"
RESERVED_SOURCES = ("file",)


@dataclass(frozen=True)
class ExternalFanSource:
    """One fan channel on a controller, bound to a GPU's PCI address."""

    kind: str
    channel: int
    path: Path | None = None
    name: str | None = None
    override: bool = False


def normalise_pci_address(address: object) -> str | None:
    """Return a lowercase 0000:bb:dd.f address, or None if unrecognised.

    NVML reports a 32-bit domain ("00000000:19:00.0"), sysfs a 16-bit one,
    and both a bare "19:00.0" is seen in hand-written config.
    """
    if not isinstance(address, str):
        return None
    text = address.strip().casefold()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) == 3:
        domain, bus, device_function = parts
    elif len(parts) == 2:
        domain, bus, device_function = "0000", parts[0], parts[1]
    else:
        return None
    if not _is_hex(domain) or len(domain) not in (4, 8) or not _is_hex(bus) or len(bus) != 2:
        return None
    device, separator, function = device_function.partition(".")
    if not separator or not _is_hex(device) or len(device) != 2:
        return None
    if len(function) != 1 or function not in "01234567":
        return None
    return f"{domain[-4:]}:{bus}:{device}.{function}"


def _is_hex(text: str) -> bool:
    return bool(text) and all(character in "0123456789abcdef" for character in text)


def parse_external_fans(raw: str | None) -> dict[str, ExternalFanSource]:
    """Parse the EXTERNAL_FANS document. A bad entry is dropped and logged."""
    if not raw or not raw.strip():
        return {}
    if len(raw) > MAX_CONFIG_CHARS:
        logger.warning(
            "EXTERNAL_FANS is %d characters, over the %d limit, ignoring it",
            len(raw),
            MAX_CONFIG_CHARS,
        )
        return {}
    try:
        document = json.loads(raw)
    except ValueError as error:
        logger.warning("EXTERNAL_FANS is not valid JSON, ignoring it: %s", error)
        return {}
    except Exception as error:  # RecursionError on deeply nested input, and anything else
        logger.warning("EXTERNAL_FANS could not be parsed, ignoring it: %s", error)
        return {}
    if not isinstance(document, dict):
        logger.warning("EXTERNAL_FANS must be an object of PCI address to fan source")
        return {}

    mapping: dict[str, ExternalFanSource] = {}
    for address, entry in document.items():
        source = _parse_entry(address, entry)
        if source is not None:
            mapping[normalise_pci_address(address)] = source
    return mapping


def _parse_entry(address: object, entry: object) -> ExternalFanSource | None:
    pci_address = normalise_pci_address(address)
    if pci_address is None:
        logger.warning("EXTERNAL_FANS entry has an unusable PCI address: %r", address)
        return None
    if not isinstance(entry, dict):
        logger.warning("EXTERNAL_FANS entry for %s is not an object", pci_address)
        return None

    kind = entry.get("source", SOURCE_HWMON)
    if kind in RESERVED_SOURCES:
        logger.warning(
            "EXTERNAL_FANS source %r is not implemented yet, ignoring %s", kind, pci_address
        )
        return None
    if kind != SOURCE_HWMON:
        logger.warning(
            "EXTERNAL_FANS entry for %s has an unknown source %r", pci_address, kind
        )
        return None

    channel = _parse_channel(entry.get("channel"))
    if channel is None:
        logger.warning(
            "EXTERNAL_FANS entry for %s needs a positive integer channel", pci_address
        )
        return None

    path = entry.get("path")
    name = entry.get("name")
    if not isinstance(path, str) or not path.strip():
        path = None
    if not isinstance(name, str) or not name.strip():
        name = None
    if path is None and name is None:
        logger.warning(
            "EXTERNAL_FANS entry for %s needs an hwmon path or name", pci_address
        )
        return None
    if path is not None and name is not None:
        logger.warning(
            "EXTERNAL_FANS entry for %s sets both an hwmon path and a name; "
            "use one or the other",
            pci_address,
        )
        return None

    return ExternalFanSource(
        kind=SOURCE_HWMON,
        channel=channel,
        path=Path(path.strip()) if path else None,
        name=name.strip() if name else None,
        override=entry.get("override") is True,
    )


def _parse_channel(channel: object) -> int | None:
    if isinstance(channel, bool) or not isinstance(channel, (int, str)):
        return None
    try:
        parsed = int(channel)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


class ExternalFanReader:
    """Add fan fields to GPU payloads from a separate fan controller."""

    def __init__(
        self,
        mapping: dict[str, ExternalFanSource] | None = None,
        hwmon_root: str | Path = HWMON_ROOT,
    ):
        self.mapping = mapping or {}
        self.hwmon_root = Path(hwmon_root)
        self._resolved: dict[str, Path] = {}
        self._ambiguous: set[str] = set()

    def __bool__(self) -> bool:
        return bool(self.mapping)

    def apply(self, gpu_payloads: dict[str, dict]) -> None:
        """Fill in fan_speed and fan_rpm for mapped GPUs, in place."""
        if not self.mapping:
            return
        for payload in gpu_payloads.values():
            try:
                self._apply_to_payload(payload)
            except Exception as error:  # never break collection over a fan reading
                logger.debug("External fan mapping failed: %s", error)

    def _apply_to_payload(self, payload: dict) -> None:
        pci_address = normalise_pci_address(payload.get("pci_bus_id"))
        source = self.mapping.get(pci_address) if pci_address else None
        if source is None:
            return
        if payload.get("fan_speed") is not None and not source.override:
            return
        payload.update(self._fan_fields(source, pci_address))

    def _fan_fields(self, source: ExternalFanSource, pci_address: str) -> dict[str, float]:
        directory = self._hwmon_directory(source)
        if directory is None:
            logger.debug(
                "External fan source for %s is not present (%s)",
                pci_address,
                source.path or source.name,
            )
            return {}

        fields: dict[str, float] = {}
        pwm = _read_number(directory / f"pwm{source.channel}")
        if pwm is not None and 0 <= pwm <= PWM_MAX:
            fields["fan_speed"] = round(pwm / PWM_MAX * 100, 1)
        rpm = _read_number(directory / f"fan{source.channel}_input")
        if rpm is not None and rpm >= 0:
            fields["fan_rpm"] = rpm
        if not fields:
            logger.debug(
                "External fan channel %d in %s gave no readable value",
                source.channel,
                directory,
            )
        return fields

    def _hwmon_directory(self, source: ExternalFanSource) -> Path | None:
        if source.path is not None:
            return source.path if source.path.is_dir() else None
        cached = self._resolved.get(source.name)
        if cached is not None and _hwmon_name(cached) == source.name:
            return cached
        self._resolved.pop(source.name, None)
        found = self._find_hwmon(source.name)
        if found is not None:
            self._resolved[source.name] = found
        return found

    def _find_hwmon(self, name: str) -> Path | None:
        """Return the one device with this name, or None if that is not unique.

        hwmon names are not required to be unique. Two controllers answering to
        the same name would otherwise bind an arbitrary channel to a GPU, so an
        ambiguous name reports nothing at all; an explicit path names the
        device the operator meant.
        """
        try:
            candidates = sorted(self.hwmon_root.glob("hwmon*"))
        except OSError:
            return None
        matches = [
            candidate for candidate in candidates if _hwmon_name(candidate) == name
        ]
        if len(matches) > 1:
            if name not in self._ambiguous:
                self._ambiguous.add(name)
                logger.warning(
                    "External fan hwmon name %r matches %d devices (%s); refusing to "
                    "guess. Give that entry an explicit path instead.",
                    name,
                    len(matches),
                    ", ".join(str(match) for match in matches),
                )
            return None
        self._ambiguous.discard(name)
        return matches[0] if matches else None


def _hwmon_name(directory: Path) -> str | None:
    return _read_text(directory / "name")


def _read_text(path: Path) -> str | None:
    """Read a small sysfs value without allowing unbounded input."""
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_SYSFS_BYTES + 1)
    except OSError:
        return None
    if len(raw) > MAX_SYSFS_BYTES:
        logger.debug("External fan file is too large: %s", path)
        return None
    try:
        return raw.decode("utf-8").strip() or None
    except UnicodeDecodeError:
        return None


def _read_number(path: Path) -> float | None:
    text = _read_text(path)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        logger.debug("External fan file is not a number: %s", path)
        return None


def create_external_fan_reader(
    raw: str | None, hwmon_root: str | Path = HWMON_ROOT
) -> ExternalFanReader:
    """Build a reader from the configured document. Empty config means off."""
    mapping = parse_external_fans(raw)
    if mapping:
        logger.info("External fan mapping active for %d GPU(s)", len(mapping))
    return ExternalFanReader(mapping, hwmon_root)
