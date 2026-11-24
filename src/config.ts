import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const PATCH_VERSION = '0.1.0';

export const MARKERS = {
  htmlStart: '<!-- rtl-patch:start -->',
  htmlEnd: '<!-- rtl-patch:end -->',
  cssStart: '/* rtl-patch:start */',
  cssEnd: '/* rtl-patch:end */',
} as const;

export function getStateDir(): string {
  const override = process.env.RTL_PATCH_STATE_DIR;
  if (override) {
    mkdirSync(override, { recursive: true });
    return override;
  }

  let base: string;
  if (process.platform === 'win32') {
    base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    base = join(base, 'rtl-patch');
  } else if (process.platform === 'darwin') {
    base = join(homedir(), 'Library', 'Application Support', 'rtl-patch');
  } else {
    base = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'rtl-patch');
  }

  mkdirSync(base, { recursive: true });
  return base;
}

export function getBackupDir(targetId: string): string {
  const dir = join(getStateDir(), 'backups', targetId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
