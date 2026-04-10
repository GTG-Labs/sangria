#!/bin/bash

# Sangria SDK Development Setup
# One script to set up everything you need

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${1}${2}${NC}"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_status $BLUE "🚀 Sangria SDK Development Setup"
print_status $BLUE "================================="
echo

# Check prerequisites
missing_deps=()
if ! command_exists python3; then missing_deps+=("python3 (>=3.10)"); fi
if ! command_exists node; then missing_deps+=("node (>=18)"); fi

if [ ${#missing_deps[@]} -ne 0 ]; then
    print_status $RED "❌ Missing dependencies:"
    for dep in "${missing_deps[@]}"; do
        print_status $RED "   - $dep"
    done
    exit 1
fi

print_status $GREEN "✅ Prerequisites found"
echo

# Python setup
print_status $BLUE "🐍 Setting up Python environment..."
if [ ! -f "../.venv/pyvenv.cfg" ]; then
    cd .. && python3 -m venv .venv && cd tests
fi

# Activate virtual environment
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    source ../.venv/Scripts/activate
else
    source ../.venv/bin/activate
fi

pip install --upgrade pip -q
pip install -r requirements.txt -q
cd ../sdk/python && pip install -e . -q && cd ../../tests
print_status $GREEN "✅ Python SDK ready"

# TypeScript setup
print_status $BLUE "📜 Setting up TypeScript..."
pnpm install
cd ../sdk/sdk-typescript && pnpm install && pnpm run build && cd ../../tests
print_status $GREEN "✅ TypeScript SDK ready"

# Install git hooks
print_status $BLUE "🔧 Installing git hooks..."
mkdir -p ../.git/hooks

cat > ../.git/hooks/pre-push << 'EOF'
#!/bin/bash
set -e
if [[ "$1" == *"main"* ]]; then
    echo "🧪 Running tests before push to main..."
    cd tests && ./run-all-tests.sh
fi
EOF

chmod +x ../.git/hooks/pre-push
print_status $GREEN "✅ Git hooks installed"

echo
print_status $GREEN "🎉 Setup complete!"
print_status $BLUE ""
print_status $BLUE "Next steps:"
print_status $BLUE "  • Run tests: ./run-all-tests.sh"
print_status $BLUE "  • Activate Python env: source ../.venv/bin/activate"
print_status $BLUE "  • Watch tests: npm run test:watch"