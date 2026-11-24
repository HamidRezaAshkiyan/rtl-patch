import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateDir } from './config.js';
import type { PatchOptions, PatchTarget } from './types.js';

function getCliScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

export async function runWatchCycle(
  targets: PatchTarget[],
  options: PatchOptions = {},
  log: (msg: string) => void = console.log,
): Promise<number> {
  let repatched = 0;
  for (const target of targets) {
    const st = await target.status(options);
    if (st.state === 'unpatched' || st.state === 'partial') {
      log(`[${new Date().toISOString()}] Detected ${target.name} is ${st.state} — re-applying RTL patch...`);
      const res = await target.apply(options);
      if (res.success && res.changed) {
        log(`[${new Date().toISOString()}] Re-patched ${target.name}: ${res.message}`);
        repatched++;
      } else if (!res.success) {
        log(`[${new Date().toISOString()}] Failed to re-patch ${target.name}: ${res.message}`);
      }
    }
  }
  return repatched;
}

export function startWatcher(
  targets: PatchTarget[],
  options: PatchOptions = {},
  intervalSeconds = 60,
): NodeJS.Timeout {
  const ms = Math.max(5, intervalSeconds) * 1000;
  console.log(
    `[rtl-patch] Watching ${targets.map((t) => t.id).join(', ')} every ${intervalSeconds}s (Ctrl+C to stop)...`,
  );

  void runWatchCycle(targets, options);
  const timer = setInterval(() => {
    void runWatchCycle(targets, options);
  }, ms);

  const stop = () => {
    clearInterval(timer);
    console.log('\n[rtl-patch] Watcher stopped.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return timer;
}

export function installWatcherService(intervalSeconds = 60): { success: boolean; message: string } {
  const nodeBin = process.execPath;
  const cliPath = getCliScriptPath();
  const logFile = join(getStateDir(), 'watcher.log');

  if (process.platform === 'darwin') {
    const label = 'com.rtl-patch.watcher';
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    mkdirSync(dirname(plistPath), { recursive: true });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${cliPath}</string>
    <string>watch</string>
    <string>--interval</string>
    <string>${intervalSeconds}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>
`;
    writeFileSync(plistPath, plist, 'utf8');
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    } catch {
      // Ignore if not previously loaded
    }
    try {
      execFileSync('launchctl', ['load', plistPath], { stdio: 'ignore' });
    } catch {
      return {
        success: true,
        message: `Wrote LaunchAgent to ${plistPath}. Run: launchctl load "${plistPath}"`,
      };
    }
    return {
      success: true,
      message: `Installed and started macOS LaunchAgent (${plistPath}). Logs: ${logFile}`,
    };
  }

  if (process.platform === 'linux') {
    const unitDir = join(homedir(), '.config', 'systemd', 'user');
    const unitPath = join(unitDir, 'rtl-patch-watcher.service');
    mkdirSync(unitDir, { recursive: true });

    const unit = `[Unit]
Description=rtl-patch auto-repatch watcher for AI coding agents
After=default.target

[Service]
Type=simple
ExecStart="${nodeBin}" "${cliPath}" watch --interval ${intervalSeconds}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
    writeFileSync(unitPath, unit, 'utf8');
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
      execFileSync('systemctl', ['--user', 'enable', '--now', 'rtl-patch-watcher.service'], {
        stdio: 'ignore',
      });
      return {
        success: true,
        message: `Installed and enabled systemd user service (${unitPath}).`,
      };
    } catch {
      return {
        success: true,
        message: `Wrote systemd unit to ${unitPath}. Run: systemctl --user enable --now rtl-patch-watcher.service`,
      };
    }
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    const startupDir = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const vbsPath = join(startupDir, 'rtl-patch-watcher.vbs');
    mkdirSync(startupDir, { recursive: true });

    const escapedNode = nodeBin.replace(/"/g, '""');
    const escapedCli = cliPath.replace(/"/g, '""');
    const vbs = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${escapedNode}"" ""${escapedCli}"" watch --interval ${intervalSeconds}", 0, False
`;
    writeFileSync(vbsPath, vbs, 'utf8');
    return {
      success: true,
      message: `Installed Windows Startup launcher (${vbsPath}). It will run silently on login.`,
    };
  }

  return {
    success: false,
    message: `Background service installation is not supported on platform: ${process.platform}`,
  };
}

export function uninstallWatcherService(): { success: boolean; message: string } {
  if (process.platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.rtl-patch.watcher.plist');
    if (!existsSync(plistPath)) {
      return { success: true, message: 'macOS LaunchAgent is not installed.' };
    }
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    } catch {
      // Ignore
    }
    unlinkSync(plistPath);
    return { success: true, message: `Removed macOS LaunchAgent (${plistPath}).` };
  }

  if (process.platform === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', 'rtl-patch-watcher.service');
    if (!existsSync(unitPath)) {
      return { success: true, message: 'systemd user service is not installed.' };
    }
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', 'rtl-patch-watcher.service'], {
        stdio: 'ignore',
      });
    } catch {
      // Ignore
    }
    unlinkSync(unitPath);
    return { success: true, message: `Removed systemd user service (${unitPath}).` };
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    const vbsPath = join(
      appData,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'rtl-patch-watcher.vbs',
    );
    if (!existsSync(vbsPath)) {
      return { success: true, message: 'Windows Startup launcher is not installed.' };
    }
    unlinkSync(vbsPath);
    return { success: true, message: `Removed Windows Startup launcher (${vbsPath}).` };
  }

  return {
    success: false,
    message: `Unsupported platform: ${process.platform}`,
  };
}
