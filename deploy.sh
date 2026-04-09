#!/bin/bash
set -euo pipefail

TARGET="../dcascaval.github.io/inverse-editing"

bun run build
rm -rf "$TARGET"/*
cp -r ./dist/* "$TARGET"/
