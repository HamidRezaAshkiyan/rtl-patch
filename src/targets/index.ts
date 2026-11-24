import type { PatchTarget } from '../types.js';
import { ElectronIdeTarget } from './electron-ide.js';
import { OpenCodeTarget } from './opencode.js';

export function getAllTargets(): PatchTarget[] {
  return [
    new ElectronIdeTarget(
      'cursor',
      'Cursor',
      'Cursor IDE AI Chat, Composer & installed AI extension webviews',
    ),
    new ElectronIdeTarget(
      'vscode',
      'VS Code',
      'VS Code Copilot Chat & installed AI extension webviews (Claude Code, Cline, Roo Code, etc.)',
    ),
    new ElectronIdeTarget(
      'vscode-insiders',
      'VS Code Insiders',
      'VS Code Insiders Copilot Chat & installed AI extension webviews',
    ),
    new OpenCodeTarget(),
  ];
}

export function resolveTargets(requestedIds?: string[]): PatchTarget[] {
  const all = getAllTargets();
  if (!requestedIds || requestedIds.length === 0 || requestedIds.includes('all')) {
    return all;
  }

  const normalized = requestedIds.map((s) => s.toLowerCase().trim());
  const matched: PatchTarget[] = [];
  for (const id of normalized) {
    const found = all.find((t) => t.id === id);
    if (!found) {
      const valid = all.map((t) => t.id).join(', ');
      throw new Error(`Unknown target "${id}". Available targets: ${valid}, all`);
    }
    if (!matched.includes(found)) {
      matched.push(found);
    }
  }
  return matched;
}
