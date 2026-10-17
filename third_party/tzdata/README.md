# Python tzdata

The Windows Cangjie runtime requires compiled TZif files selected through `CJ_TZPATH`.
This repository vendors the Python `tzdata` 2026.5 source distribution as a build input;
`scripts/prepare-zoneinfo.mjs` verifies its SHA-256 and stages only the compiled zoneinfo
tree and license files beside packaged executables.

- Source: https://pypi.org/project/tzdata/2026.5/
- Archive: `tzdata-2026.5.tar.gz`
- SHA-256: `8cc73c0a0bfca7dbfa59235d60b2eff82231dee33f53d206db1acd9173cfc0a7`
- License: Apache-2.0; license texts are copied into the staged runtime data directory.

To update this snapshot, replace the archive, update the pinned digest and version in the
packaging helper and this file, then run the package and real Host timezone tests.
