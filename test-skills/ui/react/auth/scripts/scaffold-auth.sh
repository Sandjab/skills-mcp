#!/bin/bash
set -e
echo "Scaffolding auth structure in $SKILL_ARG_PROJECT_DIR..."
mkdir -p "$SKILL_ARG_PROJECT_DIR/src/auth"
echo "Provider: ${SKILL_ARG_PROVIDER:-custom}"
echo "Done."
