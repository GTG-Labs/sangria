# SDK Directory Reorganization

This document describes the reorganization of Sangria's SDK directories that moved from a flat structure to a more organized, audience-based hierarchy.

## What Changed

### Before
```
SDK/
├── sdk-typescript/     # TypeScript merchant SDK
└── python/            # Python merchant SDK
```

### After
```
sdk/
└── merchants/
    ├── sdk-typescript/  # TypeScript merchant SDK
    └── python/         # Python merchant SDK
```

## Rationale

The reorganization provides:

1. **Logical grouping** - SDKs are now organized by target audience (`merchants`)
2. **Future extensibility** - Room for other SDK categories (e.g., `sdk/agents/` if agent SDKs are added)
3. **Clearer structure** - The directory name `sdk` (lowercase) follows standard conventions
4. **Better organization** - Merchant-specific SDKs are clearly grouped together

## Files Updated

### Documentation
- `CLAUDE.md` - Updated repository map and references
- `README.md` - Updated any SDK path references

### CI/CD Workflows
- `.github/workflows/deploy-sdks.yml`
- `.github/workflows/publish-ts-sdk.yml`
- `.github/workflows/publish-python-sdk.yml`

### Playground Examples
All playground projects updated their dependency references:
- **TypeScript projects**: `"file:../../sdk/merchants/sdk-typescript"`
- **Python projects**: `{ path = "../../sdk/merchants/python", editable = true }`

## Migration Impact

- ✅ **Zero breaking changes** - All existing SDK functionality preserved
- ✅ **CI/CD updated** - Automated deployments continue to work
- ✅ **Local development** - Playground examples work with new paths
- ✅ **Documentation current** - All references updated

## Verification

The reorganization was verified by checking:
1. No old `SDK/` directory remains
2. All workflow files use correct new paths
3. Playground examples reference new SDK locations
4. Documentation reflects new structure
5. No broken references to old paths

## Future Considerations

This structure supports future SDK expansion:
```
sdk/
├── merchants/          # Current merchant SDKs
│   ├── sdk-typescript/
│   └── python/
└── agents/            # Future agent SDKs (if needed)
    ├── sdk-typescript/
    └── python/
```