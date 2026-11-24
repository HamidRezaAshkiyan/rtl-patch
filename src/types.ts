export type PatchState = 'patched' | 'unpatched' | 'partial' | 'not-installed' | 'outdated';

export interface TargetStatus {
  id: string;
  name: string;
  state: PatchState;
  installPath?: string;
  details: string[];
  patchedFiles?: string[];
}

export interface PatchOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Override detected installation path */
  customPath?: string;
  /** OpenCode display mode: auto | visual | marks */
  opencodeMode?: 'auto' | 'visual' | 'marks';
  /** Also patch installed AI chat extension webviews (Cline, Roo Code, Claude Code ext, etc.) */
  includeExtensions?: boolean;
  /** Font family override for RTL text in IDEs (e.g. "Vazirmatn, Tahoma, sans-serif") */
  rtlFont?: string;
}

export interface PatchActionResult {
  id: string;
  name: string;
  success: boolean;
  changed: boolean;
  message: string;
  details?: string[];
}

export interface PatchTarget {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  status(options?: PatchOptions): Promise<TargetStatus>;
  apply(options?: PatchOptions): Promise<PatchActionResult>;
  revert(options?: PatchOptions): Promise<PatchActionResult>;
}
