import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKERS } from '../config.js';
import type { PatchActionResult, PatchOptions, PatchTarget, TargetStatus } from '../types.js';
import {
  computeVscodeChecksum,
  ensureBackup,
  removeMarkedBlock,
  restoreBackup,
} from '../utils/fs.js';
import {
  type ElectronIdeKind,
  findFirstExisting,
  getElectronIdeCandidates,
  getElectronIdeExtensionsDir,
  resolveWorkbenchHtml,
} from '../utils/platform.js';

const PAYLOADS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'payloads');

/** Known AI coding agent extension prefixes whose webview CSS we can patch cleanly */
const AI_EXTENSION_PREFIXES = [
  'anthropic.claude-code-',
  'saoudrizwan.claude-dev-',
  'rooveterinaryinc.roo-cline-',
  'kilocode.kilo-code-',
  'continue.continue-',
  'google.geminicodeassist-',
  'github.copilot-chat-',
];

function findAiExtensionCssFiles(extDir: string): string[] {
  if (!existsSync(extDir)) return [];
  const cssFiles: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(extDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!AI_EXTENSION_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      continue;
    }

    const base = join(extDir, entry);
    const directCandidates = [
      join(base, 'webview', 'index.css'),
      join(base, 'dist', 'webview', 'index.css'),
      join(base, 'out', 'webview', 'index.css'),
    ];

    for (const candidate of directCandidates) {
      if (existsSync(candidate)) {
        cssFiles.push(candidate);
      }
    }

    // Vite-built webviews (Cline / Roo Code / Kilo Code) place CSS under webview-ui/build/assets/*.css
    const viteAssets = join(base, 'webview-ui', 'build', 'assets');
    if (existsSync(viteAssets)) {
      try {
        for (const asset of readdirSync(viteAssets)) {
          if (asset.endsWith('.css')) {
            cssFiles.push(join(viteAssets, asset));
          }
        }
      } catch {
        // Ignore unreadable asset dir
      }
    }
  }

  return cssFiles;
}

function buildHtmlInjection(): string {
  return [
    MARKERS.htmlStart,
    '\t\t<link rel="stylesheet" href="./rtl-patch.css">',
    '\t\t<script src="./rtl-patch.js" type="module"></script>',
    MARKERS.htmlEnd,
  ].join('\n');
}

function loadWorkbenchCss(rtlFont?: string): string {
  let css = readFileSync(join(PAYLOADS_DIR, 'workbench.css'), 'utf8');
  if (rtlFont) {
    css = css.replace('--rtl-patch-font: inherit;', `--rtl-patch-font: ${rtlFont};`);
  }
  return css;
}

function loadWorkbenchJs(): string {
  return readFileSync(join(PAYLOADS_DIR, 'workbench.js'), 'utf8');
}

function loadWebviewCss(): string {
  return readFileSync(join(PAYLOADS_DIR, 'webview.css'), 'utf8');
}

/**
 * Updates a single checksum entry in VS Code / Cursor `product.json` while preserving formatting.
 */
function updateProductJsonChecksum(productPath: string, key: string, newChecksum: string): boolean {
  if (!existsSync(productPath)) return false;
  const raw = readFileSync(productPath, 'utf8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`("${escapedKey}"\\s*:\\s*)"([^"]*)"`);
  if (!regex.test(raw)) return false;
  const updated = raw.replace(regex, `$1"${newChecksum}"`);
  writeFileSync(productPath, updated, 'utf8');
  return true;
}

export class ElectronIdeTarget implements PatchTarget {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  private readonly kind: ElectronIdeKind;

  constructor(kind: ElectronIdeKind, name: string, description: string) {
    this.id = kind;
    this.kind = kind;
    this.name = name;
    this.description = description;
  }

  private resolveAppDir(options?: PatchOptions): string | undefined {
    if (options?.customPath) {
      return existsSync(options.customPath) ? options.customPath : undefined;
    }
    return findFirstExisting(getElectronIdeCandidates(this.kind));
  }

  async status(options?: PatchOptions): Promise<TargetStatus> {
    const appDir = this.resolveAppDir(options);
    if (!appDir) {
      return {
        id: this.id,
        name: this.name,
        state: 'not-installed',
        details: ['Installation not found on this machine.'],
      };
    }

    const wb = resolveWorkbenchHtml(appDir);
    if (!wb) {
      return {
        id: this.id,
        name: this.name,
        state: 'not-installed',
        installPath: appDir,
        details: [`Found app directory at ${appDir}, but workbench.html was not found.`],
      };
    }

    const wbDir = dirname(wb.htmlPath);
    const html = readFileSync(wb.htmlPath, 'utf8');
    const hasMarkers = html.includes(MARKERS.htmlStart) && html.includes(MARKERS.htmlEnd);
    const hasCss = existsSync(join(wbDir, 'rtl-patch.css'));
    const hasJs = existsSync(join(wbDir, 'rtl-patch.js'));

    const extDir = getElectronIdeExtensionsDir(this.kind);
    const extCssFiles = findAiExtensionCssFiles(extDir);
    const patchedExtCount = extCssFiles.filter((f) =>
      readFileSync(f, 'utf8').includes(MARKERS.cssStart),
    ).length;

    const details: string[] = [
      `Workbench: ${wb.htmlPath}`,
      `HTML injected: ${hasMarkers ? 'yes' : 'no'}`,
      `Payload files: ${hasCss && hasJs ? 'present' : 'missing'}`,
    ];

    if (extCssFiles.length > 0) {
      details.push(`AI extension webviews: ${patchedExtCount}/${extCssFiles.length} patched`);
    }

    let state: TargetStatus['state'];
    if (hasMarkers && hasCss && hasJs) {
      state = 'patched';
    } else if (hasMarkers || hasCss || hasJs || patchedExtCount > 0) {
      state = 'partial';
    } else {
      state = 'unpatched';
    }

    return {
      id: this.id,
      name: this.name,
      state,
      installPath: appDir,
      details,
      patchedFiles: hasMarkers ? [wb.htmlPath] : [],
    };
  }

  async apply(options?: PatchOptions): Promise<PatchActionResult> {
    const appDir = this.resolveAppDir(options);
    if (!appDir) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'Not installed (skipped).',
      };
    }

    const wb = resolveWorkbenchHtml(appDir);
    if (!wb) {
      return {
        id: this.id,
        name: this.name,
        success: false,
        changed: false,
        message: `Could not locate workbench.html inside ${appDir}.`,
      };
    }

    const wbDir = dirname(wb.htmlPath);
    const productPath = join(appDir, 'product.json');
    const cssDest = join(wbDir, 'rtl-patch.css');
    const jsDest = join(wbDir, 'rtl-patch.js');

    const details: string[] = [];

    if (options?.dryRun) {
      details.push(`[dry-run] Would write ${cssDest}`);
      details.push(`[dry-run] Would write ${jsDest}`);
      details.push(`[dry-run] Would inject RTL tags into ${wb.htmlPath}`);
      if (existsSync(productPath)) {
        details.push(`[dry-run] Would update checksum in ${productPath}`);
      }
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'Dry run completed.',
        details,
      };
    }

    try {
      const currentHtml = readFileSync(wb.htmlPath, 'utf8');
      const alreadyPatched = currentHtml.includes(MARKERS.htmlStart);

      // If workbench.html is currently unpatched (first run or freshly overwritten by an IDE update),
      // save a fresh clean backup of workbench.html (and product.json if its checksum matches the unpatched HTML).
      if (!alreadyPatched) {
        ensureBackup(this.id, wb.htmlPath, true);
        if (existsSync(productPath)) {
          const currentHtmlChecksum = computeVscodeChecksum(Buffer.from(currentHtml, 'utf8'));
          const productRaw = readFileSync(productPath, 'utf8');
          const isFreshProduct = productRaw.includes(`"${currentHtmlChecksum}"`);
          ensureBackup(this.id, productPath, isFreshProduct);
        }
      }

      // 1. Write CSS & JS payload files next to workbench.html (satisfies CSP 'self')
      writeFileSync(cssDest, loadWorkbenchCss(options?.rtlFont), 'utf8');
      writeFileSync(jsDest, loadWorkbenchJs(), 'utf8');
      details.push(`Wrote ${cssDest} and ${jsDest}`);

      // 2. Inject link + script into workbench.html
      const cleanHtml = removeMarkedBlock(currentHtml, MARKERS.htmlStart, MARKERS.htmlEnd);
      const injection = buildHtmlInjection();

      let patchedHtml: string;
      if (cleanHtml.includes('</head>')) {
        patchedHtml = cleanHtml.replace('</head>', `${injection}\n\t</head>`);
      } else if (cleanHtml.includes('</html>')) {
        patchedHtml = cleanHtml.replace('</html>', `${injection}\n</html>`);
      } else {
        patchedHtml = `${cleanHtml}\n${injection}\n`;
      }

      writeFileSync(wb.htmlPath, patchedHtml, 'utf8');
      details.push(`Injected RTL hooks into ${wb.htmlPath}`);

      // 3. Update checksum in product.json to prevent "installation appears to be corrupt" banner
      const newChecksum = computeVscodeChecksum(Buffer.from(patchedHtml, 'utf8'));
      const checksumUpdated = updateProductJsonChecksum(productPath, wb.relChecksumKey, newChecksum);
      if (checksumUpdated) {
        details.push(`Updated integrity checksum in ${productPath}`);
      }

      // 4. Patch installed AI extension webviews (Claude Code, Cline, Roo Code, etc.)
      if (options?.includeExtensions !== false) {
        const extDir = getElectronIdeExtensionsDir(this.kind);
        const extCssFiles = findAiExtensionCssFiles(extDir);
        const webviewPayload = loadWebviewCss();
        let patchedExt = 0;

        for (const extCss of extCssFiles) {
          const content = readFileSync(extCss, 'utf8');
          if (!content.includes(MARKERS.cssStart)) {
            ensureBackup(this.id, extCss, true);
          }
          const stripped = removeMarkedBlock(content, MARKERS.cssStart, MARKERS.cssEnd).trimEnd();
          writeFileSync(extCss, `${stripped}\n\n${webviewPayload}`, 'utf8');
          patchedExt++;
        }
        if (patchedExt > 0) {
          details.push(`Patched ${patchedExt} AI extension webview stylesheet(s).`);
        }
      }

      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: true,
        message: 'RTL patch applied successfully. Restart the editor to take effect.',
        details,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        msg.includes('EACCES') || msg.includes('EPERM')
          ? ' Permission denied — try running with sudo (macOS/Linux) or Administrator shell (Windows).'
          : '';
      return {
        id: this.id,
        name: this.name,
        success: false,
        changed: false,
        message: `Failed to patch ${this.name}: ${msg}.${hint}`,
        details,
      };
    }
  }

  async revert(options?: PatchOptions): Promise<PatchActionResult> {
    const appDir = this.resolveAppDir(options);
    if (!appDir) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'Not installed (nothing to revert).',
      };
    }

    const wb = resolveWorkbenchHtml(appDir);
    if (!wb) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'workbench.html not found (nothing to revert).',
      };
    }

    const wbDir = dirname(wb.htmlPath);
    const productPath = join(appDir, 'product.json');
    const cssDest = join(wbDir, 'rtl-patch.css');
    const jsDest = join(wbDir, 'rtl-patch.js');
    const details: string[] = [];

    if (options?.dryRun) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: '[dry-run] Would restore workbench.html, product.json, and remove RTL payload files.',
      };
    }

    try {
      let changed = false;

      // 1. Restore workbench.html from backup (or strip markers)
      if (restoreBackup(this.id, wb.htmlPath)) {
        details.push(`Restored original ${wb.htmlPath} from backup`);
        changed = true;
      } else {
        const html = readFileSync(wb.htmlPath, 'utf8');
        if (html.includes(MARKERS.htmlStart)) {
          const cleaned = removeMarkedBlock(html, MARKERS.htmlStart, MARKERS.htmlEnd);
          writeFileSync(wb.htmlPath, cleaned, 'utf8');
          details.push(`Stripped RTL tags from ${wb.htmlPath}`);
          changed = true;
        }
      }

      // 2. Restore product.json from backup (or recalculate checksum)
      if (existsSync(productPath)) {
        if (restoreBackup(this.id, productPath)) {
          details.push(`Restored original ${productPath} from backup`);
          changed = true;
        } else if (changed) {
          const html = readFileSync(wb.htmlPath, 'utf8');
          updateProductJsonChecksum(productPath, wb.relChecksumKey, computeVscodeChecksum(html));
        }
      }

      // 3. Remove payload files
      for (const f of [cssDest, jsDest]) {
        if (existsSync(f)) {
          unlinkSync(f);
          details.push(`Removed ${f}`);
          changed = true;
        }
      }

      // 4. Revert AI extension webview CSS files
      const extDir = getElectronIdeExtensionsDir(this.kind);
      const extCssFiles = findAiExtensionCssFiles(extDir);
      let revertedExt = 0;
      for (const extCss of extCssFiles) {
        if (restoreBackup(this.id, extCss)) {
          revertedExt++;
          changed = true;
        } else {
          const content = readFileSync(extCss, 'utf8');
          if (content.includes(MARKERS.cssStart)) {
            const stripped = removeMarkedBlock(content, MARKERS.cssStart, MARKERS.cssEnd).trimEnd();
            writeFileSync(extCss, `${stripped}\n`, 'utf8');
            revertedExt++;
            changed = true;
          }
        }
      }
      if (revertedExt > 0) {
        details.push(`Reverted ${revertedExt} AI extension webview stylesheet(s).`);
      }

      return {
        id: this.id,
        name: this.name,
        success: true,
        changed,
        message: changed
          ? 'RTL patch reverted cleanly. Restart the editor to take effect.'
          : 'Already unpatched.',
        details,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: this.id,
        name: this.name,
        success: false,
        changed: false,
        message: `Failed to revert ${this.name}: ${msg}`,
        details,
      };
    }
  }
}
