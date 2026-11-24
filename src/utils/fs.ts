import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getBackupDir } from '../config.js';

/**
 * Computes VS Code / Cursor product.json checksum format:
 * base64-encoded SHA-256 digest with trailing '=' padding stripped.
 */
export function computeVscodeChecksum(content: Buffer | string): string {
  return createHash('sha256')
    .update(content)
    .digest('base64')
    .replace(/=+$/, '');
}

/**
 * Creates a deterministic backup key for an absolute file path.
 */
function backupKey(filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16);
  const safeBase = filePath.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40);
  return `${hash}_${safeBase}.bak`;
}

export function getBackupPath(targetId: string, filePath: string): string {
  return join(getBackupDir(targetId), backupKey(filePath));
}

/**
 * Backs up a file if no backup exists yet (preserves original unpatched file).
 * Pass `overwrite = true` if you know the current file is a fresh unpatched version (e.g. after IDE update).
 */
export function ensureBackup(targetId: string, filePath: string, overwrite = false): string {
  const dest = getBackupPath(targetId, filePath);
  if (overwrite || !existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(filePath, dest);
  }
  return dest;
}

export function restoreBackup(targetId: string, filePath: string, removeBackup = true): boolean {
  const src = getBackupPath(targetId, filePath);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(filePath), { recursive: true });
  copyFileSync(src, filePath);
  if (removeBackup) {
    try {
      unlinkSync(src);
    } catch {
      // Best-effort cleanup
    }
  }
  return true;
}

export function hasBackup(targetId: string, filePath: string): boolean {
  return existsSync(getBackupPath(targetId, filePath));
}

/**
 * Strips single-line (//) and multi-line (/* *\/) comments from JSONC safely,
 * preserving string literals that contain "//" (such as URLs).
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  // Also strip trailing commas before } or ]
  return out.replace(/,\s*([}\]])/g, '$1');
}

export function readJsonFile<T = Record<string, unknown>>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(stripJsonComments(raw)) as T;
}

export function writeFileSafe(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Replaces or removes a marker-delimited block inside text.
 */
export function removeMarkedBlock(text: string, startMarker: string, endMarker: string): string {
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\r?\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\r?\\n?`, 'g');
  return text.replace(regex, '\n').replace(/\n{3,}/g, '\n\n');
}
