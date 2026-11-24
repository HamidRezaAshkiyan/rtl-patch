import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PATCH_VERSION } from '../config.js';
import type { PatchActionResult, PatchOptions, PatchTarget, TargetStatus } from '../types.js';
import { ensureBackup, readJsonFile, restoreBackup } from '../utils/fs.js';
import { findFirstExisting, getOpenCodeConfigCandidates } from '../utils/platform.js';

const PLUGIN_FILENAME = 'rtl-patch.mjs';
const PLUGIN_SPECIFIER = './plugins/rtl-patch.mjs';

function isOpencodeOnPath(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(cmd, ['opencode'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a self-contained OpenCode plugin (.mjs) with zero external dependencies.
 * - Uses `experimental.text.complete` to apply RTL shaping/BiDi or Unicode RLI/PDI marks
 *   to assistant prose while skipping fenced code blocks and inline code.
 * - Uses `experimental.chat.messages.transform` to restore original logical Unicode text
 *   before conversation history is sent back to the LLM.
 */
export function generateOpenCodePluginSource(mode: 'auto' | 'visual' | 'marks' = 'auto'): string {
  return `// rtl-patch v${PATCH_VERSION} — Self-contained OpenCode RTL Plugin
// Mode: ${mode} (override via RTL_PATCH_OPENCODE_MODE=auto|visual|marks)

const CONFIGURED_MODE = ${JSON.stringify(mode)};

const FORMS = {
  0x0621: [0xfe80, 0xfe80, null, null],
  0x0622: [0xfe81, 0xfe82, null, null],
  0x0623: [0xfe83, 0xfe84, null, null],
  0x0624: [0xfe85, 0xfe86, null, null],
  0x0625: [0xfe87, 0xfe88, null, null],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e, null, null],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94, null, null],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa, null, null],
  0x0630: [0xfeab, 0xfeac, null, null],
  0x0631: [0xfead, 0xfeae, null, null],
  0x0632: [0xfeaf, 0xfeb0, null, null],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee, null, null],
  0x0649: [0xfeef, 0xfef0, null, null],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59],
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d],
  0x0698: [0xfb8a, 0xfb8b, null, null],
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91],
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95],
  0x06c0: [0xfba4, 0xfba5, null, null],
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff],
};

const LAM_ALEF = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

const RTL_RE = /[\\u0590-\\u05FF\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;
const LTR_RE = /[A-Za-z]/;
const HARAKAT_RE = /[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

function resolveMode() {
  const m = process.env.RTL_PATCH_OPENCODE_MODE || CONFIGURED_MODE;
  if (m === 'visual' || m === 'marks') return m;
  const term = (process.env.TERM_PROGRAM || '').toLowerCase();
  // Terminals with built-in UAX #9 BiDi + HarfBuzz shaping
  if (term.includes('wezterm') || process.env.KONSOLE_VERSION || process.env.VTE_VERSION) {
    return 'marks';
  }
  return 'visual';
}

function shapeArabicPersian(text) {
  const cps = Array.from(text, (c) => c.codePointAt(0));
  const out = [];
  const isT = (cp) => HARAKAT_RE.test(String.fromCodePoint(cp));
  const connL = (cp) => cp !== undefined && FORMS[cp] !== undefined && FORMS[cp][2] !== null;
  const connR = (cp) => cp !== undefined && FORMS[cp] !== undefined;

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp === 0x200c) continue;
    if (!FORMS[cp]) { out.push(cp); continue; }
    let p = i - 1;
    while (p >= 0 && isT(cps[p])) p--;
    const prev = p >= 0 ? cps[p] : undefined;
    let n = i + 1;
    while (n < cps.length && isT(cps[n])) n++;
    const next = n < cps.length ? cps[n] : undefined;

    if (cp === 0x0644 && next !== undefined && LAM_ALEF[next]) {
      out.push(connL(prev) ? LAM_ALEF[next][1] : LAM_ALEF[next][0]);
      i = n;
      continue;
    }
    const f = FORMS[cp];
    const r = connL(prev);
    const l = f[2] !== null && connR(next);
    if (r && l && f[3] !== null) out.push(f[3]);
    else if (r) out.push(f[1]);
    else if (l && f[2] !== null) out.push(f[2]);
    else out.push(f[0]);
  }
  return String.fromCodePoint(...out);
}

function isRtlLine(line) {
  const cleaned = line.replace(/^\\s*(?:>+\\s*|#{1,6}\\s+|[-*+]\\s+|\\d+[.)]\\s+)/, '');
  for (const ch of cleaned) {
    if (RTL_RE.test(ch)) return true;
    if (LTR_RE.test(ch)) return false;
  }
  return false;
}

function reorderRtlLine(line) {
  const m = line.match(/^(\\s*(?:>+\\s*|#{1,6}\\s+|[-*+]\\s+|\\d+[.)]\\s+)?)(.*)$/);
  const prefix = m ? m[1] : '';
  const body = m ? m[2] : line;

  const runs = [];
  const protRe = /(\`[^\`]+\`|https?:\\/\\/[^\\s)]+)/g;
  let last = 0;
  let match;

  const pushPlain = (seg) => {
    let cur = null;
    let buf = '';
    const flush = () => { if (buf && cur) runs.push({ kind: cur, text: buf }); buf = ''; };
    for (const ch of seg) {
      const k = RTL_RE.test(ch) ? 'rtl' : /[A-Za-z0-9._/@#+-]/.test(ch) ? 'ltr' : 'neutral';
      if (k !== cur) { flush(); cur = k; }
      buf += ch;
    }
    flush();
  };

  while ((match = protRe.exec(body)) !== null) {
    if (match.index > last) pushPlain(body.slice(last, match.index));
    runs.push({ kind: 'ltr', text: match[0], prot: true });
    last = protRe.lastIndex;
  }
  if (last < body.length) pushPlain(body.slice(last));

  const merged = [];
  for (let i = 0; i < runs.length; i++) {
    const cur = runs[i];
    const prev = merged[merged.length - 1];
    const next = runs[i + 1];
    if (cur.kind === 'neutral' && prev?.kind === 'ltr' && !prev.prot && next?.kind === 'ltr' && !next.prot && /^[ :/_.-]+$/.test(cur.text)) {
      prev.text += cur.text + next.text;
      i++;
      continue;
    }
    merged.push(cur);
  }

  return prefix + merged.map((r) => {
    if (r.kind === 'rtl') return Array.from(shapeArabicPersian(r.text)).reverse().join('');
    if (r.kind === 'neutral') return Array.from(r.text).reverse().map((c) => MIRROR[c] ?? c).join('');
    return r.text;
  }).reverse().join('');
}

export function transformMarkdownRtl(text, mode = resolveMode()) {
  const lines = text.split('\\n');
  let inFence = false;
  let fence = '';
  return lines.map((line) => {
    const t = line.trimStart();
    if (!inFence && (t.startsWith('\`\`\`') || t.startsWith('~~~'))) {
      inFence = true;
      fence = t.slice(0, 3);
      return line;
    }
    if (inFence) {
      if (t.startsWith(fence)) { inFence = false; fence = ''; }
      return line;
    }
    if (!isRtlLine(line)) return line;
    return mode === 'marks' ? \`\\u2067\${line}\\u2069\` : reorderRtlLine(line);
  }).join('\\n');
}

// Keep original logical text so conversation history sent back to LLMs stays uncorrupted
const originalLogicalText = new Map();

export const RtlPatchPlugin = async () => {
  return {
    'experimental.text.complete': async (input, output) => {
      if (!output?.text || !RTL_RE.test(output.text)) return;
      const key = \`\${input.messageID}:\${input.partID}\`;
      originalLogicalText.set(key, output.text);
      output.text = transformMarkdownRtl(output.text);
    },
    'experimental.chat.messages.transform': async (_input, output) => {
      if (!Array.isArray(output?.messages)) return;
      for (const msg of output.messages) {
        if (!Array.isArray(msg?.parts)) continue;
        for (const part of msg.parts) {
          if (part?.type !== 'text' || typeof part.text !== 'string') continue;
          const key = \`\${msg.info?.id}:\${part.id}\`;
          const orig = originalLogicalText.get(key);
          if (orig) {
            part.text = orig;
          }
        }
      }
    },
  };
};

export default RtlPatchPlugin;
`;
}

export class OpenCodeTarget implements PatchTarget {
  readonly id = 'opencode';
  readonly name = 'OpenCode';
  readonly description = 'Installs a self-contained RTL shaping & BiDi plugin for OpenCode (TUI & Web)';

  private resolveConfigDir(options?: PatchOptions): string | undefined {
    if (options?.customPath) {
      return options.customPath;
    }
    const existing = findFirstExisting(getOpenCodeConfigCandidates());
    if (existing) return existing;
    if (isOpencodeOnPath()) {
      return getOpenCodeConfigCandidates()[0];
    }
    return undefined;
  }

  private resolveConfigFile(configDir: string): string {
    const jsonc = join(configDir, 'opencode.jsonc');
    if (existsSync(jsonc)) return jsonc;
    const json = join(configDir, 'opencode.json');
    if (existsSync(json)) return json;
    return jsonc;
  }

  async status(options?: PatchOptions): Promise<TargetStatus> {
    const configDir = this.resolveConfigDir(options);
    if (!configDir) {
      return {
        id: this.id,
        name: this.name,
        state: 'not-installed',
        details: ['OpenCode config directory and binary not found.'],
      };
    }

    const pluginPath = join(configDir, 'plugins', PLUGIN_FILENAME);
    const configFile = this.resolveConfigFile(configDir);
    const hasPluginFile = existsSync(pluginPath);

    let registered = false;
    if (existsSync(configFile)) {
      try {
        const cfg = readJsonFile<{ plugin?: unknown[] }>(configFile);
        if (Array.isArray(cfg.plugin)) {
          registered = cfg.plugin.some(
            (entry) =>
              entry === PLUGIN_SPECIFIER ||
              (Array.isArray(entry) && entry[0] === PLUGIN_SPECIFIER),
          );
        }
      } catch {
        // Ignore parse failure in status
      }
    }

    const state: TargetStatus['state'] =
      hasPluginFile && registered
        ? 'patched'
        : hasPluginFile || registered
          ? 'partial'
          : 'unpatched';

    return {
      id: this.id,
      name: this.name,
      state,
      installPath: configDir,
      details: [
        `Config dir: ${configDir}`,
        `Plugin file: ${hasPluginFile ? pluginPath : 'not installed'}`,
        `Registered in ${configFile}: ${registered ? 'yes' : 'no'}`,
      ],
      patchedFiles: hasPluginFile ? [pluginPath, configFile] : [],
    };
  }

  async apply(options?: PatchOptions): Promise<PatchActionResult> {
    const configDir = this.resolveConfigDir(options);
    if (!configDir) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'OpenCode not detected (skipped).',
      };
    }

    const pluginsDir = join(configDir, 'plugins');
    const pluginPath = join(pluginsDir, PLUGIN_FILENAME);
    const configFile = this.resolveConfigFile(configDir);
    const mode = options?.opencodeMode ?? 'auto';
    const details: string[] = [];

    if (options?.dryRun) {
      details.push(`[dry-run] Would write plugin to ${pluginPath} (mode=${mode})`);
      details.push(`[dry-run] Would register ${PLUGIN_SPECIFIER} in ${configFile}`);
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
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(pluginPath, generateOpenCodePluginSource(mode), 'utf8');
      details.push(`Wrote OpenCode RTL plugin to ${pluginPath} (mode=${mode})`);

      let cfg: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json' };
      if (existsSync(configFile)) {
        ensureBackup(this.id, configFile, false);
        cfg = readJsonFile<Record<string, unknown>>(configFile);
      }

      const plugins = Array.isArray(cfg.plugin) ? [...cfg.plugin] : [];
      const alreadyRegistered = plugins.some(
        (entry) =>
          entry === PLUGIN_SPECIFIER ||
          (Array.isArray(entry) && entry[0] === PLUGIN_SPECIFIER),
      );
      if (!alreadyRegistered) {
        plugins.push(PLUGIN_SPECIFIER);
        cfg.plugin = plugins;
      }

      writeFileSync(configFile, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
      details.push(`Registered ${PLUGIN_SPECIFIER} in ${configFile}`);

      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: true,
        message: `OpenCode RTL plugin installed (mode=${mode}). Restart OpenCode to activate.`,
        details,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: this.id,
        name: this.name,
        success: false,
        changed: false,
        message: `Failed to patch OpenCode: ${msg}`,
        details,
      };
    }
  }

  async revert(options?: PatchOptions): Promise<PatchActionResult> {
    const configDir = this.resolveConfigDir(options);
    if (!configDir) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: 'OpenCode not detected (nothing to revert).',
      };
    }

    const pluginPath = join(configDir, 'plugins', PLUGIN_FILENAME);
    const configFile = this.resolveConfigFile(configDir);
    const details: string[] = [];

    if (options?.dryRun) {
      return {
        id: this.id,
        name: this.name,
        success: true,
        changed: false,
        message: '[dry-run] Would remove OpenCode RTL plugin and unregister it.',
      };
    }

    try {
      let changed = false;

      if (existsSync(pluginPath)) {
        unlinkSync(pluginPath);
        details.push(`Removed ${pluginPath}`);
        changed = true;
      }

      if (existsSync(configFile)) {
        if (restoreBackup(this.id, configFile)) {
          details.push(`Restored original ${configFile} from backup`);
          changed = true;
        } else {
          const cfg = readJsonFile<Record<string, unknown>>(configFile);
          if (Array.isArray(cfg.plugin)) {
            const filtered = cfg.plugin.filter(
              (entry) =>
                entry !== PLUGIN_SPECIFIER &&
                !(Array.isArray(entry) && entry[0] === PLUGIN_SPECIFIER),
            );
            if (filtered.length !== cfg.plugin.length) {
              if (filtered.length === 0) {
                delete cfg.plugin;
              } else {
                cfg.plugin = filtered;
              }
              writeFileSync(configFile, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
              details.push(`Unregistered ${PLUGIN_SPECIFIER} from ${configFile}`);
              changed = true;
            }
          }
        }
      }

      return {
        id: this.id,
        name: this.name,
        success: true,
        changed,
        message: changed ? 'OpenCode RTL plugin reverted cleanly.' : 'Already unpatched.',
        details,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: this.id,
        name: this.name,
        success: false,
        changed: false,
        message: `Failed to revert OpenCode: ${msg}`,
        details,
      };
    }
  }
}
