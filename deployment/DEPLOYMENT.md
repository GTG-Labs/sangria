# SDK Deployment Guide

## 📁 Deployment Architecture

```
deployment/
├── SDK_VERSIONS.md       # Single source of truth for versions
└── DEPLOYMENT.md        # This guide

.github/workflows/
├── deploy-sdks.yml      # Main: Auto-deploy on push
├── publish-ts-sdk.yml   # Reusable: TypeScript deployment
└── publish-python-sdk.yml # Reusable: Python deployment
```

## 🚀 Quick Start

1. **Update versions** in `deployment/SDK_VERSIONS.md`
2. **Make changes** to SDK code in `sdk/`
3. **Push to main** → Automatic deployment!

## 📝 How to Deploy

### Option A: Manual Version Control (Recommended)

#### Step 1: Update Versions
Edit `deployment/SDK_VERSIONS.md`:
```markdown
## TypeScript SDK (@sangria-sdk/core)
VERSION: 0.2.0
DESCRIPTION: Added webhook support and improved error handling

## Python SDK (sangria-core)
VERSION: 0.1.1
DESCRIPTION: Fixed timeout issue in payment processing
```

#### Step 2: Make SDK Changes
Edit your SDK code in:
- `sdk/sdk-typescript/` for TypeScript changes
- `sdk/python/` for Python changes

#### Step 3: Push Both
```bash
git add .
git commit -m "feat: add webhook support and fix timeout"
git push origin main
```

### Option B: Auto-Bump Versions (Quick Fixes)

#### Step 1: Just Make SDK Changes
Edit your SDK code in:
- `sdk/sdk-typescript/` for TypeScript changes
- `sdk/python/` for Python changes

#### Step 2: Push (Without Version Update)
```bash
git add .
git commit -m "fix: typo in error message"
git push origin main
```

#### Step 3: Automatic Patch Bump
- System detects SDK changes without version update
- Auto-increments patch version (0.1.0 → 0.1.1)
- Commits the version bump to `SDK_VERSIONS.md`
- Proceeds with deployment

### Step 4: Automatic Deployment
- `deploy-sdks.yml` detects which SDKs changed
- Auto-bumps versions if needed (Option B only)
- Calls reusable workflows: `publish-ts-sdk.yml` and/or `publish-python-sdk.yml`
- All workflows read versions from `deployment/SDK_VERSIONS.md`
- TypeScript SDK → npm as `@sangria-sdk/core@0.2.0`
- Python SDK → PyPI as `sangria-core@0.1.1`
- Release tags → `ts-sdk@0.2.0`, `py-sdk@0.1.1`

## 🔄 Workflow Types

### 🤖 Automatic Deployment (`deploy-sdks.yml`)
**Triggers:** Push to main with changes in `sdk/` or `deployment/SDK_VERSIONS.md`
**Process:**
1. Detects which SDKs have code changes
2. Auto-bumps patch versions if SDK changed but versions didn't
3. Calls individual publish workflows for changed SDKs
4. Uses `test_mode: false` (real deployment)

**Example:** You push TypeScript changes → Only TypeScript SDK deploys
**Auto-bump:** SDK changes without version update → Patch version auto-incremented

### 🎛️ Manual Deployment (`publish-*-sdk.yml`)
**Triggers:** Manual workflow dispatch from GitHub Actions UI
**Process:**
1. Run individual workflows directly
2. Deploy without needing code changes
3. Choose dry run mode if desired

**Use cases:**
- Republish with same code
- Deploy after fixing secrets
- Test deployment process

### 📞 Reusable Workflows
Both individual workflows support:
- `workflow_call` - Called by main deployment workflow
- `workflow_dispatch` - Manual execution from GitHub UI
- `test_mode` input - Dry run option

## ⚙️ Setup (One Time)

**Required GitHub Secrets:**
- `NPM_TOKEN` - For npm publishing
- `PYPI_TOKEN` - For PyPI publishing

**Get NPM Token:**
1. Go to [npmjs.com](https://www.npmjs.com/settings/tokens)
2. Create "Automation" token
3. Add as `NPM_TOKEN` secret

**Get PyPI Token:**
1. Go to [pypi.org](https://pypi.org/manage/account/token/)
2. Create API token
3. Add as `PYPI_TOKEN` secret

## 📋 Version Guidelines

**Semantic Versioning:**
- **Patch** (0.1.0 → 0.1.1): Bug fixes, documentation
- **Minor** (0.1.0 → 0.2.0): New features, backward compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes

## 🔍 When Deployment Happens

**Automatic (deploy-sdks.yml):**
- Triggers on push to main with SDK changes
- Detects which SDKs changed
- Auto-bumps patch versions if no manual version update
- Calls individual publish workflows for changed SDKs

**Manual (publish-*-sdk.yml):**
- Run individual workflows from GitHub Actions UI
- Deploy without needing code changes
- Useful for republishing with same code

**Both read versions from `SDK_VERSIONS.md`**

## 🤖 Auto-Version Bump Details

**When it happens:**
- SDK code changes detected (`sdk/sdk-typescript/` or `sdk/python/`)
- No version changes in `deployment/SDK_VERSIONS.md`

**What it does:**
- Increments patch version (e.g., 0.1.5 → 0.1.6)
- Updates `SDK_VERSIONS.md` automatically
- Commits the change with message: "chore: auto-bump patch versions for SDK changes"
- Continues with normal deployment process

**Use for:**
- Bug fixes and small updates
- Quick patches without manual version management
- Ensures every SDK change gets a unique version

## 📊 Monitor Progress

Watch at: `https://github.com/GTG-Labs/sangria-net/actions`

## 🛠️ Troubleshooting

**NPM publish fails:**
- Check `NPM_TOKEN` is valid
- Ensure version hasn't been published before
- Verify package name access

**PyPI publish fails:**
- Check `PYPI_TOKEN` is valid
- Ensure version hasn't been published before
- Verify package name access

**Version parsing fails:**
- Check `SDK_VERSIONS.md` format matches exactly
- Ensure `VERSION:` and `DESCRIPTION:` labels are present
