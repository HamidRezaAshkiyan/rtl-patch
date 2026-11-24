# rtl-patch

Cross-platform global RTL (Persian, Arabic, Hebrew) patcher for AI coding agents.

**Website & Interactive Demo:** https://hamidrezaashkiyan.github.io/rtl-patch/

## Supported Targets (v1)

| Target ID | Agent / Editor | How it patches |
|---|---|---|
| `cursor` | **Cursor IDE** | Injects CSP-safe CSS + Trusted-Types-safe `MutationObserver` into `workbench.html`, updates `product.json` integrity checksum, and patches installed AI extension webviews. |
| `vscode` | **VS Code** (Copilot Chat, Claude Code ext, Cline, Roo Code, Kilo Code, Continue, Gemini Code Assist) | Same workbench + checksum patch + automatic webview CSS patching for installed AI extensions. |
| `vscode-insiders` | **VS Code Insiders** | Same as `vscode`. |
| `opencode` | **OpenCode** | Installs a self-contained ESM plugin (`~/.config/opencode/plugins/rtl-patch.mjs`) that shapes & BiDi-reorders RTL prose (skipping code blocks) while keeping conversation history sent back to LLMs in clean logical Unicode. |

Code blocks (`pre`, `code`, diffs, terminals, inline code) are always locked to **LTR**.

## Quick Start

```bash
npm install
npm run build
npm link # makes `rtl-patch` available globally
```

### Commands

```bash
# Check detected agents and current RTL patch status
rtl-patch status

# Preview changes without modifying any files
rtl-patch apply --dry-run

# Apply RTL patch to all detected agents
rtl-patch apply

# Apply to specific agents with a custom Persian/Arabic font
rtl-patch apply vscode cursor --rtl-font "Vazirmatn, Tahoma, sans-serif"

# Apply to OpenCode with explicit mode (auto | visual | marks)
rtl-patch apply opencode --opencode-mode auto

# Cleanly revert all patches and restore original backups
rtl-patch revert
```

### Auto-Repatch After IDE Updates (`watch`)

Because VS Code and Cursor overwrite `workbench.html` when they auto-update, `rtl-patch` includes a lightweight background watcher:

```bash
# Run in foreground (polls every 60s)
rtl-patch watch

# Install as a background service (macOS LaunchAgent / Linux systemd user unit / Windows Startup)
rtl-patch watch --install

# Remove background service
rtl-patch watch --uninstall
```

## OpenCode Terminal Modes

- `auto` *(default)*: Uses `marks` (Unicode RLI/PDI isolates) in native BiDi terminals (`WezTerm`, `Konsole`, `VTE`), and `visual` (Arabic/Persian contextual shaping + visual BiDi reordering) in non-BiDi terminals (`iTerm2`, `Ghostty`, `Alacritty`, `Terminal.app`, VS Code terminal).
- Override anytime via `RTL_PATCH_OPENCODE_MODE=visual` or `RTL_PATCH_OPENCODE_MODE=marks`.

## Running Tests

```bash
npm test
```
