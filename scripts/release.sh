#!/bin/bash

set -e

VERSION=${1:-"0.1.0"}
DIST_DIR="dist/sacode-${VERSION}"

echo "Building SaCode ${VERSION}..."

mkdir -p ${DIST_DIR}/bin
mkdir -p ${DIST_DIR}/lib
mkdir -p ${DIST_DIR}/include
mkdir -p ${DIST_DIR}/sdk

cargo build --release

cp target/release/sacode ${DIST_DIR}/bin/

if [ -f target/release/libsacode_kernel.so ]; then
  cp target/release/libsacode_kernel.so ${DIST_DIR}/lib/
fi

if [ -f target/release/libsacode_kernel.dylib ]; then
  cp target/release/libsacode_kernel.dylib ${DIST_DIR}/lib/
fi

if [ -f target/release/sacode_kernel.dll ]; then
  cp target/release/sacode_kernel.dll ${DIST_DIR}/lib/
fi

cp include/sacode.h ${DIST_DIR}/include/

cp sdk/README.md ${DIST_DIR}/sdk/

cp docs/PRD.md ${DIST_DIR}/
cp README.md ${DIST_DIR}/

tar -czf dist/sacode-${VERSION}-linux-x64.tar.gz -C dist sacode-${VERSION}

echo "Distribution package created: dist/sacode-${VERSION}-linux-x64.tar.gz"
