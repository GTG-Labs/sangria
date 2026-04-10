# Sangria SDK CI/CD Documentation

This directory contains GitHub Actions workflows and related CI/CD configuration for the Sangria SDK repository.

## Workflows Overview

### 🔀 `test-pr.yml` - Pull Request Testing

**Triggers:** Pull requests to `main` branch

**Purpose:** Comprehensive testing and validation of PRs before merge

**Jobs:**
- **test-python-sdk** - Python SDK unit and integration tests
- **test-typescript-sdk** - TypeScript SDK unit and integration tests
- **test-integration** - Full cross-SDK integration testing
- **build-verification** - Multi-platform build testing (Node 18/20, Python 3.10/3.11)
- **security-scan** - Trivy vulnerability scanning
- **pr-summary** - Generates test results summary

**Features:**
- Parallel test execution for performance
- Test result artifacts and reports
- JUnit XML output for test results
- Coverage reporting
- Linting and type checking
- Security vulnerability scanning
- Automated PR summary with test status

### 🌟 `test-main.yml` - Main Branch Testing

**Triggers:**
- Pushes to `main` branch
- Daily schedule (6 AM UTC)

**Purpose:** Comprehensive testing and monitoring of main branch

**Jobs:**
- **comprehensive-test** - Full test suite with detailed coverage
- **multi-platform-test** - Cross-platform compatibility testing
- **security-audit** - Security auditing with CodeQL and safety checks

**Features:**
- Detailed HTML coverage reports
- Multi-platform testing (Ubuntu, Windows, macOS)
- Automatic issue creation on test failures
- Security auditing with multiple tools
- Daily regression testing

## Test Strategy

### Unit Tests
- **Python SDK**: Model validation, HTTP client, core functionality
- **TypeScript SDK**: Core logic, type validation, framework adapters

### Integration Tests
- API contract testing with realistic mock responses
- HTTP request/response validation
- Authentication and error handling
- Cross-platform compatibility

### Security Testing
- Dependency vulnerability scanning
- Code quality analysis
- Static analysis with CodeQL
- Python security checks with bandit and safety

## Artifacts and Reports

### Test Results
- JUnit XML format for integration with GitHub UI
- HTML coverage reports for detailed analysis
- Test timing and performance metrics

### Coverage Reports
- TypeScript coverage via Vitest
- Python coverage via pytest-cov
- Combined reporting for full repository coverage

### Security Reports
- Trivy SARIF format for GitHub Security tab
- CodeQL analysis results
- Dependency audit reports

## Configuration

### Environment Variables
```yaml
NODE_VERSION: '18'        # Node.js version for all jobs
PYTHON_VERSION: '3.10'   # Python version for all jobs
```

### Matrix Testing
```yaml
# Multi-platform testing
os: [ubuntu-latest, windows-latest, macos-latest]
python-version: ['3.10', '3.11']
node-version: [18, 20]
```

## Local Development Integration

### Git Hooks
The repository includes a pre-push hook that runs automatically:

```bash
# Install hooks
./scripts/install-hooks.sh

# Setup complete development environment
./scripts/setup-dev-environment.sh
```

### Hook Behavior
- **Pushing to main**: Full test suite runs (matches CI)
- **Pushing to other branches**: Quick validation checks
- **Emergency bypass**: `git push --no-verify`

## Workflow Dependencies

### Required Actions
- `actions/checkout@v4` - Code checkout
- `actions/setup-python@v4` - Python environment
- `actions/setup-node@v4` - Node.js environment
- `actions/upload-artifact@v3` - Artifact management

### Security Actions
- `aquasecurity/trivy-action@master` - Vulnerability scanning
- `github/codeql-action/init@v2` - Code analysis
- `github/codeql-action/upload-sarif@v2` - Security report upload

## Performance Optimization

### Parallel Execution
- Python and TypeScript tests run in parallel
- Independent job execution where possible
- Matrix builds for multi-platform testing

### Caching Strategy
- NPM dependency caching
- Python pip caching
- Build artifact caching

### Resource Management
- Appropriate timeouts for different test types
- Fail-fast strategies for matrix builds
- Efficient artifact management

## Monitoring and Notifications

### Failure Handling
- Automatic issue creation for main branch failures
- Detailed error reporting in PR comments
- Test result summaries in GitHub UI

### Status Checks
- Required status checks for PR merging
- Branch protection rules enforcement
- Clear pass/fail indicators

## Troubleshooting

### Common Issues

1. **Test Timeouts**
   - Check test performance and resource usage
   - Increase timeout values if needed
   - Optimize test setup and teardown

2. **Dependency Issues**
   - Verify package-lock.json and requirements.txt are up to date
   - Check for version conflicts
   - Clear caches if needed

3. **Platform-Specific Failures**
   - Review matrix build results
   - Check platform-specific dependencies
   - Validate file path handling

### Debug Strategies

1. **Local Reproduction**
   ```bash
   # Run exact same commands as CI
   ./tests/run-all-tests.sh
   ```

2. **Artifact Analysis**
   - Download test result artifacts
   - Review coverage reports
   - Check security scan results

3. **Log Analysis**
   - Use GitHub Actions log filtering
   - Focus on specific job failures
   - Compare with successful runs

## Maintenance

### Regular Updates
- Keep action versions up to date
- Monitor for new security tools
- Update Node.js and Python versions as needed

### Performance Monitoring
- Track test execution times
- Monitor resource usage
- Optimize bottlenecks

### Security Reviews
- Regular review of dependency updates
- Monitor security advisories
- Update scanning tools and configurations

## Contributing

When modifying workflows:

1. Test changes in a fork first
2. Use semantic PR titles for clarity
3. Update documentation for new features
4. Consider backward compatibility
5. Monitor resource usage impact

### Workflow Best Practices
- Use specific action versions (not `@latest`)
- Include descriptive job and step names
- Add appropriate error handling
- Document any special requirements
- Test edge cases and failure scenarios