# AGENTS.md — rtl-patch

## Overview
Cross-platform Node.js/TypeScript CLI that patches AI coding agents (`cursor`, `vscode`, `vscode-insiders`, `opencode`) for clean RTL (Persian, Arabic, Hebrew) prose rendering while locking code blocks, diffs, inline code, and terminals to LTR. Includes a background watcher service to automatically re-apply patches after IDE auto-updates.

## Tech Stack & Requirements
- **Language / Runtime:** TypeScript 5.7+ (`strict: true`, `ES2022`, `NodeNext` ESM) on Node.js `>=18.0.0`
- **Dependencies:** Zero runtime dependencies (Node.js built-ins only); `devDependencies`: `typescript`, `@types/node`
- **Test Runner:** Built-in `node --test`

## Repository Structure
```text
rtl-patch/
├── package.json                  # ESM package, `rtl-patch` bin -> ./dist/src/cli.js
├── tsconfig.json                 # Compiles src/ and tests/ -> dist/
├── scripts/
│   └── copy-assets.mjs           # Copies src/payloads/ -> dist/src/payloads/ & chmod +x cli.js
├── src/
│   ├── cli.ts                    # CLI entry point (status, apply, revert, watch, list)
│   ├── config.ts                 # PATCH_VERSION, HTML/CSS markers, OS state & backup dirs
│   ├── types.ts                  # Shared Target, PatchOptions, PatchState types
│   ├── watcher.ts                # Foreground polling watcher + LaunchAgent/systemd/Windows Startup installer
│   ├── targets/
│   │   ├── index.ts              # Target registry & resolution
│   │   ├── electron-ide.ts       # Cursor, VS Code, VS Code Insiders workbench + checksum + extension webview patcher
│   │   └── opencode.ts           # Generates self-contained ~/.config/opencode/plugins/rtl-patch.mjs
│   ├── payloads/
│   │   ├── workbench.css         # Injected Electron workbench RTL styles (code locked LTR)
│   │   ├── workbench.js          # CSP-safe & Trusted-Types-safe MutationObserver
│   │   └── webview.css           # Injected into installed AI extension webviews
│   └── utils/
│       ├── bidi.ts               # Arabic/Persian contextual shaping & visual BiDi reordering
│       ├── fs.ts                 # Atomic/backup file helpers
│       └── platform.ts           # OS-specific IDE installation & config path detection
├── tests/
│   ├── bidi.test.ts
│   ├── electron-ide.test.ts
│   └── opencode.test.ts
└── docs/
    └── index.html                # GitHub Pages website & interactive demo
```

## Architecture & Key Flows
- **Electron IDEs (`src/targets/electron-ide.ts`):** Locates `workbench.html` and `product.json`, backs up originals to the state backup dir, injects `workbench.css` + `workbench.js` wrapped in `MARKERS` (`<!-- rtl-patch:start -->` / `<!-- rtl-patch:end -->`), recalculates the `product.json` integrity checksum so the IDE doesn't warn about corrupt installation, and optionally patches installed AI extension webviews (Copilot Chat, Claude Code ext, Cline, Roo Code, Kilo Code, Continue, Gemini Code Assist) unless `--no-extensions` is passed.
- **OpenCode (`src/targets/opencode.ts`):** Writes a self-contained ESM plugin to `~/.config/opencode/plugins/rtl-patch.mjs` supporting `auto`, `visual` (contextual shaping + visual BiDi for non-BiDi terminals), and `marks` (RLI/PDI Unicode isolates for native BiDi terminals). Leaves conversation history sent back to LLMs in clean logical Unicode.
- **Auto-Repatch Watcher (`src/watcher.ts`):** Polls targets every `--interval` seconds (default `60`) to re-apply patches overwritten by IDE updates; `--install` / `--uninstall` manages OS-native user services (macOS LaunchAgent, Linux systemd user unit, Windows Startup).

## Development & Commands
```bash
npm install
npm run build         # tsc && node scripts/copy-assets.mjs
npm test              # npm run build && node --test dist/tests/*.test.js
npm start -- status   # Run compiled CLI directly
npm link              # Expose `rtl-patch` globally

# Common CLI commands
rtl-patch status
rtl-patch apply --dry-run
rtl-patch apply vscode cursor --rtl-font "Vazirmatn, Tahoma, sans-serif"
rtl-patch apply opencode --opencode-mode auto
rtl-patch revert
rtl-patch watch --install
```

## Configuration & Environment
- `RTL_PATCH_STATE_DIR` — Overrides OS default state/backup directory (`~/Library/Application Support/rtl-patch` on macOS, `%APPDATA%\rtl-patch` on Windows, `$XDG_STATE_HOME/rtl-patch` on Linux).
- `RTL_PATCH_OPENCODE_MODE` — Runtime override for OpenCode plugin (`visual` | `marks`).
- `NO_COLOR` — Disables ANSI colors in CLI output.

## Conventions & Gotchas
- **Always run `npm run build` (not raw `tsc`):** `scripts/copy-assets.mjs` is required to copy `src/payloads/*` into `dist/src/payloads/` and `chmod +x dist/src/cli.js`.
- **ESM `.js` extensions in TS imports:** `tsconfig.json` uses `"module": "NodeNext"`, so relative imports in `src/*.ts` must use `.js` extensions.
- **CSP & Trusted Types safety:** Changes to `src/payloads/workbench.js` must avoid `innerHTML` and unsafe eval/inline violations inside Electron's strict CSP and Trusted Types policies.
- **Idempotent marker-based patching:** All injected blocks must use `MARKERS` from `src/config.ts` so `status`, re-`apply`, and `revert` remain clean and reversible.
- **Code blocks stay LTR:** Never apply `direction: rtl` broadly without excluding `pre`, `code`, diffs, and terminal containers.
