# Contributing to Sangria SDK

Thank you for your interest in contributing to Sangria SDK! This document provides guidelines and information for contributors.

## Development Setup

### Quick Setup
```bash
# Clone and setup development environment
git clone <repository-url>
cd sangria-net
./setup.sh
```

This script will:
- Set up Python virtual environment
- Install all dependencies (Python and TypeScript)
- Build the TypeScript SDK
- Install git hooks for quality assurance

### Manual Setup

1. **Prerequisites**
   - Python ≥ 3.10
   - Node.js ≥ 18
   - Git

2. **Python Environment**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Linux/Mac
   # or .venv\Scripts\activate  # Windows

   pip install -r tests/requirements.txt
   cd sdk/python && pip install -e . && cd ../..
   ```

3. **TypeScript Environment**
   ```bash
   cd tests && npm install && cd ..
   cd sdk/sdk-typescript && npm install && npm run build && cd ../..
   ```

4. **Git Hooks** (already handled by ./setup.sh)

## Testing

### Running Tests

```bash
# All tests (comprehensive)
cd tests && ./run-all-tests.sh

# Python tests only
python -m pytest tests/python/ -v

# TypeScript tests only
cd tests && npm run test:typescript

# Watch mode for development
cd tests && npm run test:watch
```

### Test Structure

- **Unit Tests**: Test individual functions and classes in isolation
- **Integration Tests**: Test API contracts and cross-component interactions
- **Framework Tests**: Test framework-specific adapters (Express, Hono, Fastify)

### Writing Tests

1. **Python Tests**
   - Use `pytest` with async support
   - Mock HTTP calls with `respx`
   - Place unit tests in `tests/python/unit/`
   - Place integration tests in `tests/python/integration/`

2. **TypeScript Tests**
   - Use Vitest for all TypeScript testing
   - Mock HTTP calls with MSW (Mock Service Worker)
   - Place unit tests in `tests/typescript/unit/`
   - Place integration tests in `tests/typescript/integration/`

3. **Test Guidelines**
   - Test both success and failure scenarios
   - Use realistic mock data
   - Include edge cases (invalid inputs, network errors)
   - Keep tests focused and fast

## Code Quality

### Pre-Push Hooks

Git hooks automatically run when you push to ensure code quality:

- **Pushing to `main`**: Full test suite + linting
- **Pushing to other branches**: Quick validation checks
- **Emergency bypass**: `git push --no-verify`

### Manual Quality Checks

```bash
# Python formatting and linting
python -m black tests/python/ sdk/python/src/
flake8 tests/python/ sdk/python/src/
mypy sdk/python/src/sangria_sdk/

# TypeScript linting
cd tests && npm run lint:ts
```

## Pull Request Process

### 1. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes
- Follow existing code patterns
- Add tests for new functionality
- Update documentation if needed

### 3. Test Your Changes
```bash
cd tests && ./run-all-tests.sh  # Full test suite
```

### 4. Commit and Push
```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

### 5. Create Pull Request
- Target the `main` branch
- Use a descriptive title
- Include details about what changed and why
- Link any related issues

## CI/CD Pipeline

### Automated Checks on PRs

When you create a PR to `main`, GitHub Actions will automatically run:

1. **Python SDK Tests** (unit + integration)
2. **TypeScript SDK Tests** (unit + integration)
3. **Cross-Platform Compatibility** (Ubuntu, Windows, macOS)
4. **Security Scanning** (Trivy vulnerability scan)
5. **Code Quality** (linting, type checking)
6. **Build Verification** (multiple Node/Python versions)

### Required Status Checks

All automated checks must pass before a PR can be merged.

### Main Branch Protection

The `main` branch runs additional checks:
- Comprehensive test suite
- Multi-platform testing
- Security auditing
- Daily regression testing

## SDK Architecture

### Python SDK (`/sdk/python/`)
- **Client**: Main `SangriaMerchantClient` class
- **Models**: Data classes for payment handling
- **HTTP**: HTTP client with proper error handling
- **Adapters**: Framework-specific integrations (FastAPI)

### TypeScript SDK (`/sdk/sdk-typescript/`)
- **Core**: Main `Sangria` class with payment logic
- **Types**: TypeScript interfaces and type definitions
- **Adapters**: Framework middleware (Express, Hono, Fastify)

## Common Patterns

### Error Handling
- Always handle network failures gracefully
- Return appropriate error responses, don't throw exceptions
- Use structured error responses with error reasons

### Testing Patterns
- Mock external API calls
- Use realistic test data
- Test authentication flows
- Validate request/response formats

### API Design
- Follow existing patterns for consistency
- Use clear, descriptive method names
- Provide comprehensive type definitions
- Include examples in documentation

## Release Process

1. **Version Bump**: Update version numbers in package files
2. **Changelog**: Update CHANGELOG.md with new features/fixes
3. **Testing**: Ensure all tests pass on multiple platforms
4. **Documentation**: Update README and documentation as needed
5. **Release**: Create GitHub release with proper tags

## Getting Help

### Documentation
- [Test Suite Documentation](tests/README.md)
- [CI/CD Documentation](.github/README.md)
- [SDK Architecture](Sangria-Architecture.md)

### Communication
- Create GitHub issues for bugs or feature requests
- Use draft PRs for work-in-progress discussions
- Tag maintainers for urgent issues

### Debugging
- Check GitHub Actions logs for CI failures
- Run tests locally to reproduce issues
- Use `./setup.sh` to reset environment

## Code of Conduct

- Be respectful and professional
- Focus on constructive feedback
- Help maintain a welcoming environment
- Follow established patterns and conventions

## Recognition

Contributors will be recognized in:
- CHANGELOG.md for significant contributions
- GitHub contributors list
- Release notes for major features

Thank you for contributing to Sangria SDK! 🚀