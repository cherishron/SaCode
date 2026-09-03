#!/usr/bin/env python3
"""Rewrite a VSIX/ZIP with deterministic metadata and entry ordering."""

from __future__ import annotations

import argparse
import os
import tempfile
import zipfile
from pathlib import Path

FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def normalize(vsix: Path) -> None:
    if not vsix.is_file():
        raise SystemExit(f"VSIX not found: {vsix}")

    with zipfile.ZipFile(vsix, "r") as source:
        entries = []
        for info in source.infolist():
            if info.is_dir():
                continue
            entries.append((info.filename, source.read(info.filename)))

    fd, temp_name = tempfile.mkstemp(prefix=f".{vsix.name}.", suffix=".tmp", dir=vsix.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        with zipfile.ZipFile(
            temp,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as target:
            for name, content in sorted(entries, key=lambda item: item[0]):
                normalized = zipfile.ZipInfo(name, FIXED_TIMESTAMP)
                normalized.compress_type = zipfile.ZIP_DEFLATED
                normalized.create_system = 3
                normalized.external_attr = 0o100644 << 16
                normalized.flag_bits = 0x800
                target.writestr(normalized, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        temp.replace(vsix)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("vsix", type=Path)
    args = parser.parse_args()
    normalize(args.vsix.resolve())
