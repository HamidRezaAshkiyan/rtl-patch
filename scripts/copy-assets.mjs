import { cpSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcPayloads = join(root, 'src', 'payloads');
const distPayloads = join(root, 'dist', 'src', 'payloads');

mkdirSync(distPayloads, { recursive: true });
cpSync(srcPayloads, distPayloads, { recursive: true });

const cliPath = join(root, 'dist', 'src', 'cli.js');
if (existsSync(cliPath)) {
  try {
    chmodSync(cliPath, 0o755);
  } catch {
    // Ignore on platforms where chmod is a no-op (Windows)
  }
}
