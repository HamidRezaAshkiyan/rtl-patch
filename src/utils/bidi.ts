/**
 * Pure TypeScript Arabic/Persian contextual shaper & BiDi visual reorderer
 * with Markdown-awareness (skips fenced code blocks & preserves inline code LTR).
 */

type GlyphForms = readonly [isolated: number, final: number, initial: number | null, medial: number | null];

/**
 * Arabic & Persian Unicode -> Presentation Forms-B (and A for Persian letters)
 * Format: [isolated, final, initial | null, medial | null]
 * Letters with null initial/medial are right-joining only (do not connect to the next letter).
 */
const FORMS: Record<number, GlyphForms> = {
  0x0621: [0xfe80, 0xfe80, null, null], // ء HAMZA
  0x0622: [0xfe81, 0xfe82, null, null], // آ ALEF WITH MADDA
  0x0623: [0xfe83, 0xfe84, null, null], // أ ALEF WITH HAMZA ABOVE
  0x0624: [0xfe85, 0xfe86, null, null], // ؤ WAW WITH HAMZA
  0x0625: [0xfe87, 0xfe88, null, null], // إ ALEF WITH HAMZA BELOW
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // ئ YEH WITH HAMZA
  0x0627: [0xfe8d, 0xfe8e, null, null], // ا ALEF
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // ب BEH
  0x0629: [0xfe93, 0xfe94, null, null], // ة TEH MARBUTA
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // ت TEH
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // ث THEH
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // ج JEEM
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // ح HAH
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // خ KHAH
  0x062f: [0xfea9, 0xfeaa, null, null], // د DAL
  0x0630: [0xfeab, 0xfeac, null, null], // ذ THAL
  0x0631: [0xfead, 0xfeae, null, null], // ر REH
  0x0632: [0xfeaf, 0xfeb0, null, null], // ز ZAIN
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // س SEEN
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // ش SHEEN
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // ص SAD
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // ض DAD
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // ط TAH
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // ظ ZAH
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // ع AIN
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // غ GHAIN
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // ـ TATWEEL
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // ف FEH
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // ق QAF
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // ك ARABIC KAF
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // ل LAM
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // م MEEM
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // ن NOON
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // ه HEH
  0x0648: [0xfeed, 0xfeee, null, null], // و WAW
  0x0649: [0xfeef, 0xfef0, null, null], // ى ALEF MAKSURA
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // ي ARABIC YEH
  // Persian / Urdu extensions
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59], // پ PEH
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], // چ TCHEH
  0x0698: [0xfb8a, 0xfb8b, null, null], // ژ JEH
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91], // ک KEHEH (Persian Kaf)
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95], // گ GAF
  0x06c0: [0xfba4, 0xfba5, null, null], // ۀ HEH WITH YEH ABOVE
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff], // ی FARSI YEH
};

// Lam-Alef ligatures: [isolated, final]
const LAM_ALEF: Record<number, readonly [number, number]> = {
  0x0622: [0xfef5, 0xfef6], // لآ
  0x0623: [0xfef7, 0xfef8], // لأ
  0x0625: [0xfef9, 0xfefa], // لإ
  0x0627: [0xfefb, 0xfefc], // لا
};

const RTL_CHAR_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const STRONG_LTR_RE = /[A-Za-z]/;
const HARAKAT_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/;

const MIRROR_MAP: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};

function isTransparent(cp: number): boolean {
  return HARAKAT_RE.test(String.fromCodePoint(cp));
}

function connectsLeft(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  const f = FORMS[cp];
  return f !== undefined && f[2] !== null;
}

function connectsRight(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  return FORMS[cp] !== undefined;
}

/**
 * Contextually shapes Arabic/Persian letters into Presentation Forms
 * so terminals without HarfBuzz shaping display connected glyphs.
 */
export function shapeArabicPersian(text: string): string {
  const cps = Array.from(text, (c) => c.codePointAt(0)!);
  const out: number[] = [];

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];

    // ZWNJ (نیم‌فاصله) breaks joining and is dropped after shaping
    if (cp === 0x200c) {
      continue;
    }

    if (!FORMS[cp]) {
      out.push(cp);
      continue;
    }

    // Look back for previous non-transparent char
    let prevIdx = i - 1;
    while (prevIdx >= 0 && isTransparent(cps[prevIdx])) prevIdx--;
    const prev = prevIdx >= 0 ? cps[prevIdx] : undefined;

    // Look forward for next non-transparent char
    let nextIdx = i + 1;
    while (nextIdx < cps.length && isTransparent(cps[nextIdx])) nextIdx++;
    const next = nextIdx < cps.length ? cps[nextIdx] : undefined;

    // Lam + Alef ligature
    if (cp === 0x0644 && next !== undefined && LAM_ALEF[next]) {
      const lig = LAM_ALEF[next];
      const joinedRight = connectsLeft(prev);
      out.push(joinedRight ? lig[1] : lig[0]);
      // Skip ahead past the alef (preserve any diacritics between them if any)
      i = nextIdx;
      continue;
    }

    const forms = FORMS[cp];
    const joinedRight = connectsLeft(prev);
    const joinedLeft = forms[2] !== null && connectsRight(next);

    if (joinedRight && joinedLeft && forms[3] !== null) {
      out.push(forms[3]); // medial
    } else if (joinedRight) {
      out.push(forms[1]); // final
    } else if (joinedLeft && forms[2] !== null) {
      out.push(forms[2]); // initial
    } else {
      out.push(forms[0]); // isolated
    }
  }

  return String.fromCodePoint(...out);
}

/**
 * Determines whether a line should be treated as RTL based on its first strong directional character.
 */
export function isRtlLine(line: string): boolean {
  // Strip common markdown leading tokens before checking direction
  const cleaned = line.replace(/^\s*(?:>+\s*|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '');
  for (const ch of cleaned) {
    if (RTL_CHAR_RE.test(ch)) return true;
    if (STRONG_LTR_RE.test(ch)) return false;
  }
  return false;
}

type RunKind = 'rtl' | 'ltr' | 'neutral';

interface Run {
  kind: RunKind;
  text: string;
  protected?: boolean; // inline code, URLs, etc. kept strictly LTR
}

/**
 * Splits a single RTL line into directional runs, keeping inline code (`...`)
 * and URLs intact as protected LTR runs.
 */
function tokenizeRuns(line: string): Run[] {
  const runs: Run[] = [];
  // Match inline code spans or URLs first
  const protectedRe = /(`[^`]+`|https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (segment: string) => {
    if (!segment) return;
    let curKind: RunKind | null = null;
    let buf = '';

    const flush = () => {
      if (buf && curKind) {
        runs.push({ kind: curKind, text: buf });
      }
      buf = '';
    };

    for (const ch of segment) {
      let kind: RunKind;
      if (RTL_CHAR_RE.test(ch)) {
        kind = 'rtl';
      } else if (/[A-Za-z0-9._/@#+-]/.test(ch)) {
        kind = 'ltr';
      } else {
        kind = 'neutral';
      }

      if (kind !== curKind) {
        flush();
        curKind = kind;
      }
      buf += ch;
    }
    flush();
  };

  while ((match = protectedRe.exec(line)) !== null) {
    if (match.index > lastIndex) {
      pushPlain(line.slice(lastIndex, match.index));
    }
    runs.push({ kind: 'ltr', text: match[0], protected: true });
    lastIndex = protectedRe.lastIndex;
  }
  if (lastIndex < line.length) {
    pushPlain(line.slice(lastIndex));
  }

  // Merge neutral spaces between two LTR runs so phrases like "VS Code" stay together
  const merged: Run[] = [];
  for (let i = 0; i < runs.length; i++) {
    const cur = runs[i];
    const prev = merged[merged.length - 1];
    const next = runs[i + 1];

    if (
      cur.kind === 'neutral' &&
      prev &&
      prev.kind === 'ltr' &&
      !prev.protected &&
      next &&
      next.kind === 'ltr' &&
      !next.protected &&
      /^[ :/_.-]+$/.test(cur.text)
    ) {
      prev.text += cur.text + next.text;
      i++;
      continue;
    }
    merged.push(cur);
  }

  return merged;
}

/**
 * Reorders an RTL line into visual left-to-right terminal cell order.
 */
export function reorderRtlLineVisual(line: string): string {
  // Keep markdown list/heading/blockquote prefix on the left so terminal markdown parsers still recognize it
  const prefixMatch = line.match(/^(\s*(?:>+\s*|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?)(.*)$/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const body = prefixMatch ? prefixMatch[2] : line;

  const runs = tokenizeRuns(body);
  const transformed = runs.map((run) => {
    if (run.kind === 'rtl') {
      const shaped = shapeArabicPersian(run.text);
      return Array.from(shaped).reverse().join('');
    }
    if (run.kind === 'neutral') {
      return Array.from(run.text)
        .reverse()
        .map((c) => MIRROR_MAP[c] ?? c)
        .join('');
    }
    // LTR run stays in logical LTR order
    return run.text;
  });

  return prefix + transformed.reverse().join('');
}

export type BidiTransformMode = 'visual' | 'marks';

/**
 * Transforms a Markdown document for RTL display while leaving fenced code blocks untouched.
 * - `visual`: reshapes Arabic/Persian glyphs and reorders RTL lines for non-BiDi terminals
 * - `marks`: wraps RTL lines in Unicode RLI/PDI isolate marks (\u2067...\u2069) for native BiDi terminals/web UIs
 */
export function transformMarkdownRtl(markdown: string, mode: BidiTransformMode = 'visual'): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceChar = '';

  const out = lines.map((line) => {
    const trimmed = line.trimStart();
    if (!inFence && (trimmed.startsWith('```') || trimmed.startsWith('~~~'))) {
      inFence = true;
      fenceChar = trimmed.slice(0, 3);
      return line;
    }
    if (inFence) {
      if (trimmed.startsWith(fenceChar)) {
        inFence = false;
        fenceChar = '';
      }
      return line;
    }

    if (!isRtlLine(line)) {
      return line;
    }

    if (mode === 'marks') {
      return `\u2067${line}\u2069`;
    }
    return reorderRtlLineVisual(line);
  });

  return out.join('\n');
}
