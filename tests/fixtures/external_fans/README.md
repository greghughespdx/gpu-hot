# External fan controller fixture snapshot

This fixture records the hwmon tree of a Linux host that cools two passive
GPUs with a USB-attached fan controller. It was read through a read-only SSH
session at 2026-09-11T21:35:10Z.

The host exposes three hwmon devices. Two are the `amdgpu` devices of the two
cards themselves, and neither of them has a fan node, because the cards are
passive. The third is the fan controller, named `arctic_fan`, with ten
channels: `fanN_input` in RPM and `pwmN` in the kernel's 0 to 255 range.

Only two channels have a blower attached. Channel 1 cools the card at PCI
`0000:19:00.0` and channel 2 cools the card at `0000:67:00.0`; that mapping
was measured on the source host, not inferred, and it is the reason the
mapping in this project is configuration rather than discovery. The unused
channels read 0 RPM at PWM 255, which is what an empty header looks like and
is worth keeping in the fixture.

The `amdgpu` hwmon directories carry only their `name` file here. They exist
so that resolving the controller by name has to scan past other devices, the
same as it does on a real host.

Commands used, all read-only:

* `cat /sys/class/hwmon/hwmon*/name`
* `cat /sys/class/hwmon/hwmon2/fanN_input` and `.../pwmN` for each channel
* `ls -la /sys/class/drm/card*/device` and `cat .../uevent` for the PCI
  addresses of the two cards

No hostnames, addresses, or credentials are recorded in the fixture files.
