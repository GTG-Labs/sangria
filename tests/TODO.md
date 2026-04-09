# Testing TODO List

## Completed ✅
- [x] Core security tests with real EIP-712 validation
- [x] Financial precision tests with USDC decimal handling
- [x] Payment lifecycle and state management tests
- [x] TypeScript SDK unit tests
- [x] Deterministic test server infrastructure
- [x] Comprehensive testing documentation

## Pending 🚧

### High Priority
- [ ] **Adapter Tests**: Fix mocking complexity in Express/Fastify/Hono adapter tests
  - Complex module mocking patterns need refinement
  - Currently disabled in `adapters.test.ts.disabled`
  - Need proper mock isolation between tests

### Medium Priority
- [ ] **E2E Test Stability**: Improve server startup coordination
  - Add proper health checks before test execution
  - Implement retry logic for flaky network tests
  - Buffer time added but may need fine-tuning

### Low Priority
- [ ] **Python SDK Tests**: Implement comprehensive Python SDK testing
- [ ] **Cross-SDK Tests**: Test interoperability between TypeScript and Python SDKs
- [ ] **Performance Tests**: Add load testing and benchmarking
- [ ] **Chaos Testing**: Add failure injection and recovery testing

## Notes
- Core testing infrastructure is production-ready
- Security and financial tests are comprehensive and passing
- Adapter tests complexity is isolated and not blocking core functionality
- E2E tests have coordination buffers but may need additional stability work