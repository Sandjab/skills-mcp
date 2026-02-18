#!/bin/bash
echo "Linting component..."
eslint "$1" --ext .tsx,.ts
