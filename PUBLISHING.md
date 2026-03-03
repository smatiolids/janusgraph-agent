# Publishing Guide

This document describes how to publish a new `graphx-ai` version and how to test it locally before pushing.

## Prerequisites

- Node.js 20+
- `pnpm` installed
- npm account with publish access to `graphx-ai`
- Logged into npm (`npm login`)

## 1. Prepare the Release Branch

1. Ensure you are on the branch you want to release from.
```bash
git checkout main
git pull
```
2. Confirm there are no unintended local changes.
```bash
git status
```

## 2. Update Version

1. Bump the version in `package.json` (follow semver).
2. Commit the version bump and release notes/docs updates.
```bash
git add package.json README.md PUBLISHING.MD
git commit -m "chore(release): bump version to X.Y.Z"
```

## 3. Local Quality Checks (Before Push)

Run all checks locally:

```bash
pnpm install
pnpm test
pnpm lint
```

## 4. Build and Package Validation

1. Validate what will be published:
```bash
npm_config_cache=/tmp/npm-cache pnpm pack:check
```

2. Create the `dist/` folder for release artifacts:
```bash
mkdir -p dist
```

3. Create the real tarball directly in `dist/`:
```bash
npm_config_cache=/tmp/npm-cache npm pack --pack-destination dist
```

If your npm version does not support `--pack-destination`, use:
```bash
npm_config_cache=/tmp/npm-cache npm pack
mv graphx-ai-X.Y.Z.tgz dist/
```

Expected output: `dist/graphx-ai-X.Y.Z.tgz`

## 5. Test the Package Locally (NPX Flow)

Run the packed version exactly how end users will run it:

```bash
npm_config_cache=/tmp/npm-cache OPENAI_API_KEY=your_key_here npx -y ./dist/graphx-ai-X.Y.Z.tgz help
npm_config_cache=/tmp/npm-cache OPENAI_API_KEY=your_key_here npx -y ./dist/graphx-ai-X.Y.Z.tgz --port 3100
```

Then open `http://localhost:3100` and validate:

- App starts successfully
- Server/session CRUD works
- Agent generates and runs queries
- Graph renders as expected

If startup fails or appears stuck, inspect the CLI log file:

```bash
tail -n 200 ./log/cli.log
```

Optional: isolate runtime files in a temp folder:

```bash
mkdir -p /tmp/graphx-ai-test-home
GRAPHX_AI_HOME=/tmp/graphx-ai-test-home npm_config_cache=/tmp/npm-cache OPENAI_API_KEY=your_key_here npx -y ./dist/graphx-ai-X.Y.Z.tgz --port 3100
```

## Generate Dist Packages (Quick Commands)

Use this when you only want to generate package files in `dist/`:

```bash
mkdir -p dist
npm_config_cache=/tmp/npm-cache npm pack --pack-destination dist
ls -lh dist/*.tgz
```

## 6. Push and Tag

After local checks pass:

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 7. Publish to npm

Publish from the same commit/tag you validated:

```bash
npm publish
```

Verify:

```bash
npm view graphx-ai version
```

## 8. Post-Publish Smoke Test

From a clean folder:

```bash
mkdir -p /tmp/graphx-ai-smoke && cd /tmp/graphx-ai-smoke
OPENAI_API_KEY=your_key_here npx graphx-ai help
OPENAI_API_KEY=your_key_here npx graphx-ai --port 3200
```

Open `http://localhost:3200` and confirm startup.

## Rollback / Deprecation

If a bad version is published, prefer deprecation messaging:

```bash
npm deprecate graphx-ai@X.Y.Z "Deprecated due to issue <short reason>. Use <fixed-version>."
```

Avoid unpublishing except when absolutely necessary and allowed by npm policy.
