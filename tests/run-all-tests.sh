#!/bin/bash

# Run all Sangria SDK tests
set -e

echo "🧪 Running Sangria SDK Tests..."

# Activate Python environment if available
if [ -f "../.venv/bin/activate" ]; then
    source ../.venv/bin/activate
elif [ -f "../.venv/Scripts/activate" ]; then
    source ../.venv/Scripts/activate
fi

# Python tests
echo "🐍 Python tests..."
cd ..
python3 -m pytest tests/python/ -v --tb=short
cd tests

# TypeScript tests
echo "📜 TypeScript tests..."
NODE_ENV=unit-test pnpm test:typescript

echo "✅ All tests passed!"