---
description: |
  Run the full CI pipeline locally (lint → typecheck → test → build) for both BE and FE, in the same order as GitHub Actions.

  Use BEFORE pushing or opening a PR to catch failures early.
  Also use when the user says "check everything", "does CI pass?", "ready to push?", or "run the pipeline".
---

# Local CI Pipeline — Satellites

Mirrors `.github/workflows/ci.yml` exactly. Run all steps in order; stop and report as soon as one fails.

## Environment

Node is managed via nvm. Always use full binary paths — never bare `npm` or `node` commands:

```
NODE_BIN=/home/cristian/.nvm/versions/node/v24.14.1/bin
NPM=$NODE_BIN/npm
NODE=$NODE_BIN/node
```

Prefix every npm invocation:
```bash
PATH="$NODE_BIN:$PATH" $NODE $NPM <args>
```

## Step order

Run these sequentially. If any step exits non-zero, stop immediately, report which step failed and show the last 30 lines of output.

### Backend (`satellites-be/`)

```bash
cd satellites-be
PATH="$NODE_BIN:$PATH" $NODE $NPM run lint
PATH="$NODE_BIN:$PATH" $NODE $NPM run typecheck
PATH="$NODE_BIN:$PATH" $NODE $NPM test
PATH="$NODE_BIN:$PATH" $NODE $NPM run build
```

### Frontend (`satellites-fe/`)

```bash
cd satellites-fe
PATH="$NODE_BIN:$PATH" $NODE $NPM run lint
PATH="$NODE_BIN:$PATH" $NODE $NPM run typecheck
PATH="$NODE_BIN:$PATH" $NODE $NPM test -- --watch=false
PATH="$NODE_BIN:$PATH" $NODE $NPM run build
```

## Reporting

After all steps complete, print a summary table:

| Step              | BE     | FE     |
|-------------------|--------|--------|
| lint              | ✅/❌  | ✅/❌  |
| typecheck         | ✅/❌  | ✅/❌  |
| test              | ✅/❌  | ✅/❌  |
| build             | ✅/❌  | ✅/❌  |

If everything passes: "Pipeline green — safe to push."
If something fails: show the failing command's output and suggest a fix based on the error.
