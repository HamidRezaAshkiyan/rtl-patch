#!/usr/bin/env node
import { PATCH_VERSION } from './config.js';
import { getAllTargets, resolveTargets } from './targets/index.js';
import type { PatchOptions, PatchState } from './types.js';
import { installWatcherService, startWatcher, uninstallWatcherService } from './watcher.js';

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

function formatState(state: PatchState): string {
  switch (state) {
    case 'patched':
      return c.green('PATCHED');
    case 'unpatched':
      return c.yellow('UNPATCHED');
    case 'partial':
      return c.yellow('PARTIAL');
    case 'outdated':
      return c.yellow('OUTDATED');
    case 'not-installed':
      return c.dim('NOT INSTALLED');
  }
}

function printHelp(): void {
  console.log(`
${c.bold('rtl-patch')} v${PATCH_VERSION} — Cross-platform RTL patcher for AI coding agents

${c.bold('USAGE')}
  rtl-patch <command> [targets...] [options]

${c.bold('COMMANDS')}
  status [targets...]      Inspect detected agents and current RTL patch state
  apply  [targets...]      Apply RTL patches (default: all detected targets)
  revert [targets...]      Cleanly revert RTL patches and restore backups
  watch  [targets...]      Watch for IDE updates and auto-reapply RTL patches
  list                     List all supported target IDs

${c.bold('TARGETS')}
  all                      All detected targets (default)
  cursor                   Cursor IDE (AI Chat, Composer & extension webviews)
  vscode                   VS Code (Copilot Chat & extension webviews)
  vscode-insiders          VS Code Insiders
  opencode                 OpenCode (self-contained RTL plugin)

${c.bold('OPTIONS')}
  --dry-run                Preview changes without modifying any files
  --no-extensions          Skip patching VS Code / Cursor AI extension webviews
  --rtl-font <css-font>    Custom CSS font-family for RTL text (e.g. "Vazirmatn, sans-serif")
  --opencode-mode <mode>   OpenCode mode: auto (default) | visual | marks
  --path <dir>             Override installation/config directory (single target)
  --interval <seconds>     Watch polling interval in seconds (default: 60)
  --install                Install background watcher (LaunchAgent / systemd / Windows Startup)
  --uninstall              Remove background watcher service
  -h, --help               Show this help message
  -v, --version            Show version
`);
}

interface ParsedArgs {
  command: string;
  targets: string[];
  options: PatchOptions;
  interval: number;
  installService: boolean;
  uninstallService: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options: PatchOptions = { includeExtensions: true };
  let interval = 60;
  let installService = false;
  let uninstallService = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      return {
        command: 'help',
        targets: [],
        options,
        interval,
        installService,
        uninstallService,
      };
    }
    if (arg === '-v' || arg === '--version') {
      return {
        command: 'version',
        targets: [],
        options,
        interval,
        installService,
        uninstallService,
      };
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--no-extensions') {
      options.includeExtensions = false;
    } else if (arg === '--install') {
      installService = true;
    } else if (arg === '--uninstall') {
      uninstallService = true;
    } else if (arg === '--rtl-font' && argv[i + 1]) {
      options.rtlFont = argv[++i];
    } else if (arg === '--path' && argv[i + 1]) {
      options.customPath = argv[++i];
    } else if (arg === '--opencode-mode' && argv[i + 1]) {
      const m = argv[++i];
      if (m !== 'auto' && m !== 'visual' && m !== 'marks') {
        throw new Error(`Invalid --opencode-mode "${m}". Use: auto, visual, or marks.`);
      }
      options.opencodeMode = m;
    } else if (arg === '--interval' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 5) {
        throw new Error('--interval must be a number >= 5 seconds.');
      }
      interval = Math.floor(n);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [command = 'help', ...targets] = positional;
  return { command, targets, options, interval, installService, uninstallService };
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(c.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  if (parsed.command === 'version') {
    console.log(PATCH_VERSION);
    return;
  }

  if (parsed.command === 'list') {
    console.log(c.bold('Supported targets:'));
    for (const t of getAllTargets()) {
      console.log(`  ${c.cyan(t.id.padEnd(18))} ${t.description}`);
    }
    return;
  }

  if (parsed.command === 'watch') {
    if (parsed.installService) {
      const res = installWatcherService(parsed.interval);
      console.log(res.success ? c.green(res.message) : c.red(res.message));
      if (!res.success) process.exit(1);
      return;
    }
    if (parsed.uninstallService) {
      const res = uninstallWatcherService();
      console.log(res.success ? c.green(res.message) : c.red(res.message));
      if (!res.success) process.exit(1);
      return;
    }
    const targets = resolveTargets(parsed.targets);
    startWatcher(targets, parsed.options, parsed.interval);
    return;
  }

  let targets;
  try {
    targets = resolveTargets(parsed.targets);
  } catch (err) {
    console.error(c.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (parsed.command === 'status') {
    console.log(c.bold(`rtl-patch v${PATCH_VERSION} — Target Status\n`));
    for (const target of targets) {
      const st = await target.status(parsed.options);
      console.log(`${c.bold(st.name)} ${c.dim(`(${st.id})`)}  [${formatState(st.state)}]`);
      for (const line of st.details) {
        console.log(`  ${c.dim('•')} ${line}`);
      }
      console.log();
    }
    return;
  }

  if (parsed.command === 'apply') {
    let anyFailed = false;
    for (const target of targets) {
      const res = await target.apply(parsed.options);
      const badge = !res.success
        ? c.red('FAILED')
        : res.changed
          ? c.green('APPLIED')
          : c.dim('SKIPPED');
      console.log(`${c.bold(res.name)} [${badge}] — ${res.message}`);
      if (res.details) {
        for (const d of res.details) {
          console.log(`  ${c.dim('•')} ${d}`);
        }
      }
      if (!res.success) anyFailed = true;
    }
    if (anyFailed) process.exit(1);
    return;
  }

  if (parsed.command === 'revert') {
    let anyFailed = false;
    for (const target of targets) {
      const res = await target.revert(parsed.options);
      const badge = !res.success
        ? c.red('FAILED')
        : res.changed
          ? c.green('REVERTED')
          : c.dim('UNCHANGED');
      console.log(`${c.bold(res.name)} [${badge}] — ${res.message}`);
      if (res.details) {
        for (const d of res.details) {
          console.log(`  ${c.dim('•')} ${d}`);
        }
      }
      if (!res.success) anyFailed = true;
    }
    if (anyFailed) process.exit(1);
    return;
  }

  console.error(c.red(`Unknown command: "${parsed.command}"`));
  printHelp();
  process.exit(1);
}

void main();
