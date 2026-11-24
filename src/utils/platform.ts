import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ElectronIdeKind = 'vscode' | 'vscode-insiders' | 'cursor';

/**
 * Returns candidate installation "app" directories (the directory containing `product.json` and `out/`)
 * across macOS, Linux, and Windows.
 */
export function getElectronIdeCandidates(kind: ElectronIdeKind): string[] {
  const home = homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    const appNames: Record<ElectronIdeKind, string[]> = {
      vscode: ['Visual Studio Code.app'],
      'vscode-insiders': ['Visual Studio Code - Insiders.app'],
      cursor: ['Cursor.app'],
    };
    for (const app of appNames[kind]) {
      candidates.push(join('/Applications', app, 'Contents', 'Resources', 'app'));
      candidates.push(join(home, 'Applications', app, 'Contents', 'Resources', 'app'));
    }
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    if (kind === 'vscode') {
      candidates.push(
        join(localAppData, 'Programs', 'Microsoft VS Code', 'resources', 'app'),
        join(programFiles, 'Microsoft VS Code', 'resources', 'app'),
        join(programFilesX86, 'Microsoft VS Code', 'resources', 'app'),
      );
    } else if (kind === 'vscode-insiders') {
      candidates.push(
        join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'resources', 'app'),
        join(programFiles, 'Microsoft VS Code Insiders', 'resources', 'app'),
      );
    } else if (kind === 'cursor') {
      candidates.push(
        join(localAppData, 'Programs', 'cursor', 'resources', 'app'),
        join(localAppData, 'Programs', 'Cursor', 'resources', 'app'),
        join(programFiles, 'Cursor', 'resources', 'app'),
      );
    }
  } else {
    // Linux
    if (kind === 'vscode') {
      candidates.push(
        '/usr/share/code/resources/app',
        '/opt/visual-studio-code/resources/app',
        '/snap/code/current/usr/share/code/resources/app',
        join(home, '.local', 'share', 'code', 'resources', 'app'),
      );
    } else if (kind === 'vscode-insiders') {
      candidates.push(
        '/usr/share/code-insiders/resources/app',
        '/opt/visual-studio-code-insiders/resources/app',
        '/snap/code-insiders/current/usr/share/code-insiders/resources/app',
      );
    } else if (kind === 'cursor') {
      candidates.push(
        '/usr/share/cursor/resources/app',
        '/opt/cursor/resources/app',
        '/opt/Cursor/resources/app',
        join(home, '.local', 'share', 'cursor', 'resources', 'app'),
        join(home, '.local', 'share', 'Cursor', 'resources', 'app'),
      );
    }
  }

  return candidates;
}

/**
 * Returns the user extensions directory for a VS Code fork across OSes.
 */
export function getElectronIdeExtensionsDir(kind: ElectronIdeKind): string {
  const home = homedir();
  const folderMap: Record<ElectronIdeKind, string> = {
    vscode: '.vscode',
    'vscode-insiders': '.vscode-insiders',
    cursor: '.cursor',
  };
  return join(home, folderMap[kind], 'extensions');
}

/**
 * Finds the first existing directory from a candidate list.
 */
export function findFirstExisting(paths: string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Returns candidate OpenCode config directories across macOS, Linux, and Windows.
 */
export function getOpenCodeConfigCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  if (process.env.OPENCODE_CONFIG_DIR) {
    candidates.push(process.env.OPENCODE_CONFIG_DIR);
  }
  if (process.env.XDG_CONFIG_HOME) {
    candidates.push(join(process.env.XDG_CONFIG_HOME, 'opencode'));
  }

  candidates.push(join(home, '.config', 'opencode'));

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    candidates.push(join(appData, 'opencode'));
  }

  return [...new Set(candidates)];
}

/**
 * Resolves the workbench.html path inside an Electron IDE `app` directory.
 * Supports both modern `electron-browser` and legacy `electron-sandbox` layouts.
 */
export function resolveWorkbenchHtml(appDir: string): { htmlPath: string; relChecksumKey: string } | undefined {
  const layouts = [
    {
      relPath: join('out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
      checksumKey: 'vs/code/electron-browser/workbench/workbench.html',
    },
    {
      relPath: join('out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
      checksumKey: 'vs/code/electron-sandbox/workbench/workbench.html',
    },
  ];

  for (const layout of layouts) {
    const full = join(appDir, layout.relPath);
    if (existsSync(full)) {
      return { htmlPath: full, relChecksumKey: layout.checksumKey };
    }
  }
  return undefined;
}
