import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenCodeTarget } from '../src/targets/opencode.js';

describe('OpenCodeTarget', () => {
  let tmpRoot: string;
  let configDir: string;
  let configPath: string;
  let origConfig: string;
  const prevStateEnv = process.env.RTL_PATCH_STATE_DIR;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'rtl-patch-opencode-test-'));
    process.env.RTL_PATCH_STATE_DIR = join(tmpRoot, 'state');

    configDir = join(tmpRoot, 'opencode');
    mkdirSync(configDir, { recursive: true });

    configPath = join(configDir, 'opencode.jsonc');
    origConfig = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    writeFileSync(configPath, origConfig, 'utf8');
  });

  afterEach(() => {
    if (prevStateEnv === undefined) delete process.env.RTL_PATCH_STATE_DIR;
    else process.env.RTL_PATCH_STATE_DIR = prevStateEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('installs working self-contained OpenCode plugin and reverts cleanly', async () => {
    const target = new OpenCodeTarget();
    const opts = { customPath: configDir, opencodeMode: 'visual' as const };

    assert.equal((await target.status(opts)).state, 'unpatched');

    const applyRes = await target.apply(opts);
    assert.equal(applyRes.success, true);
    assert.equal(applyRes.changed, true);
    assert.equal((await target.status(opts)).state, 'patched');

    const pluginPath = join(configDir, 'plugins', 'rtl-patch.mjs');
    assert.ok(existsSync(pluginPath));

    // Dynamically import the generated plugin and test both hooks!
    const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const hooks = await mod.default();

    const originalText = 'سلام دنیا `console.log(1)`';
    const textOutput = { text: originalText };
    await hooks['experimental.text.complete'](
      { sessionID: 's1', messageID: 'm1', partID: 'p1' },
      textOutput,
    );
    // Output should be transformed for visual display while preserving inline code
    assert.notEqual(textOutput.text, originalText);
    assert.ok(textOutput.text.includes('`console.log(1)`'));

    // Messages sent back to LLM should be restored to clean logical Unicode!
    const historyOutput = {
      messages: [
        {
          info: { id: 'm1' },
          parts: [{ id: 'p1', type: 'text', text: textOutput.text }],
        },
      ],
    };
    await hooks['experimental.chat.messages.transform']({}, historyOutput);
    assert.equal(historyOutput.messages[0].parts[0].text, originalText);

    // Revert
    const revertRes = await target.revert(opts);
    assert.equal(revertRes.success, true);
    assert.equal(revertRes.changed, true);
    assert.ok(!existsSync(pluginPath));
    assert.equal(readFileSync(configPath, 'utf8'), origConfig);
    assert.equal((await target.status(opts)).state, 'unpatched');
  });
});
