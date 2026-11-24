import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElectronIdeTarget } from '../src/targets/electron-ide.js';
import { computeVscodeChecksum } from '../src/utils/fs.js';
import { runWatchCycle } from '../src/watcher.js';

describe('ElectronIdeTarget (VS Code / Cursor)', () => {
  let tmpRoot: string;
  let appDir: string;
  let wbHtmlPath: string;
  let productPath: string;
  let stateDir: string;
  let origHtml: string;
  let origProduct: string;
  const prevStateEnv = process.env.RTL_PATCH_STATE_DIR;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'rtl-patch-ide-test-'));
    stateDir = join(tmpRoot, 'state');
    process.env.RTL_PATCH_STATE_DIR = stateDir;

    appDir = join(tmpRoot, 'app');
    const wbDir = join(appDir, 'out', 'vs', 'code', 'electron-browser', 'workbench');
    mkdirSync(wbDir, { recursive: true });

    wbHtmlPath = join(wbDir, 'workbench.html');
    origHtml = [
      '<!DOCTYPE html>',
      '<html>',
      '\t<head>',
      '\t\t<meta charset="utf-8" />',
      '\t\t<link rel="stylesheet" href="../../../workbench/workbench.desktop.main.css">',
      '\t</head>',
      '\t<body></body>',
      '\t<script src="./workbench.js" type="module"></script>',
      '</html>',
      '',
    ].join('\n');
    writeFileSync(wbHtmlPath, origHtml, 'utf8');

    productPath = join(appDir, 'product.json');
    origProduct = JSON.stringify(
      {
        nameShort: 'Code',
        checksums: {
          'vs/code/electron-browser/workbench/workbench.html': computeVscodeChecksum(origHtml),
        },
      },
      null,
      2,
    );
    writeFileSync(productPath, origProduct, 'utf8');
  });

  afterEach(() => {
    if (prevStateEnv === undefined) delete process.env.RTL_PATCH_STATE_DIR;
    else process.env.RTL_PATCH_STATE_DIR = prevStateEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('applies, updates checksum, survives IDE update via watch, and reverts byte-for-byte', async () => {
    const target = new ElectronIdeTarget('vscode', 'VS Code', 'Test target');
    const opts = { customPath: appDir, includeExtensions: false };

    // 1. Initial status
    const st0 = await target.status(opts);
    assert.equal(st0.state, 'unpatched');

    // 2. Apply patch
    const applyRes = await target.apply({ ...opts, rtlFont: 'Vazirmatn, sans-serif' });
    assert.equal(applyRes.success, true);
    assert.equal(applyRes.changed, true);

    const st1 = await target.status(opts);
    assert.equal(st1.state, 'patched');

    const wbDir = join(appDir, 'out', 'vs', 'code', 'electron-browser', 'workbench');
    assert.ok(existsSync(join(wbDir, 'rtl-patch.css')));
    assert.ok(existsSync(join(wbDir, 'rtl-patch.js')));
    assert.ok(readFileSync(join(wbDir, 'rtl-patch.css'), 'utf8').includes('Vazirmatn, sans-serif'));

    // Verify product.json checksum matches patched workbench.html
    const patchedHtml = readFileSync(wbHtmlPath, 'utf8');
    const updatedProduct = JSON.parse(readFileSync(productPath, 'utf8'));
    assert.equal(
      updatedProduct.checksums['vs/code/electron-browser/workbench/workbench.html'],
      computeVscodeChecksum(patchedHtml),
    );

    // 3. Simulate IDE auto-update overwriting workbench.html
    writeFileSync(wbHtmlPath, origHtml, 'utf8');
    const stAfterUpdate = await target.status(opts);
    assert.equal(stAfterUpdate.state, 'partial');

    const repatchedCount = await runWatchCycle([target], opts, () => {});
    assert.equal(repatchedCount, 1);
    assert.equal((await target.status(opts)).state, 'patched');

    // 4. Revert and verify byte-exact restore
    const revertRes = await target.revert(opts);
    assert.equal(revertRes.success, true);
    assert.equal(revertRes.changed, true);
    assert.equal(readFileSync(wbHtmlPath, 'utf8'), origHtml);
    assert.equal(readFileSync(productPath, 'utf8'), origProduct);
    assert.ok(!existsSync(join(wbDir, 'rtl-patch.css')));
    assert.ok(!existsSync(join(wbDir, 'rtl-patch.js')));
    assert.equal((await target.status(opts)).state, 'unpatched');
  });
});
