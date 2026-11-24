import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRtlLine,
  reorderRtlLineVisual,
  shapeArabicPersian,
  transformMarkdownRtl,
} from '../src/utils/bidi.js';

describe('bidi & Arabic/Persian shaper', () => {
  it('shapes Persian words into connected presentation forms', () => {
    const shaped = shapeArabicPersian('سلام');
    // س (initial \uFEB3) + لا (final ligature \uFEFC) + م (isolated \uFEE1)
    assert.equal(shaped, '\ufeb3\ufefc\ufee1');
  });

  it('handles Persian-specific letters (پ چ ژ گ ک ی) and ZWNJ (نیم‌فاصله)', () => {
    const withZwnj = shapeArabicPersian('می\u200cخواهم');
    // ZWNJ should be consumed and prevent ی from joining خ (م ی خ و ا ه م = 7 letters)
    assert.ok(!withZwnj.includes('\u200c'));
    assert.equal(withZwnj.length, 7);
    // ی before ZWNJ should be final (\uFBFD), not medial (\uFBFF)
    assert.equal(withZwnj.codePointAt(1), 0xfbfd);

    const persian = shapeArabicPersian('پژوهشگر');
    assert.equal(persian.length, 7);
    assert.equal(persian.codePointAt(0), 0xfb58); // پ initial
  });

  it('detects RTL vs LTR lines accurately (ignoring markdown prefixes)', () => {
    assert.equal(isRtlLine('سلام دنیا'), true);
    assert.equal(isRtlLine('## عنوان فارسی'), true);
    assert.equal(isRtlLine('- مورد اول'), true);
    assert.equal(isRtlLine('1. Hello world'), false);
    assert.equal(isRtlLine('const x = 42;'), false);
  });

  it('keeps inline code LTR inside RTL lines', () => {
    const visual = reorderRtlLineVisual('برای نصب دستور `npm install` را اجرا کنید');
    assert.ok(visual.includes('`npm install`'), `Expected inline code preserved LTR, got: ${visual}`);
  });

  it('skips fenced code blocks in markdown', () => {
    const md = [
      'سلام این یک تست است',
      '```ts',
      '// نظر فارسی داخل کد نباید تغییر کند',
      'const msg = "سلام";',
      '```',
      'پایان',
    ].join('\n');

    const visual = transformMarkdownRtl(md, 'visual');
    const lines = visual.split('\n');
    assert.equal(lines[1], '```ts');
    assert.equal(lines[2], '// نظر فارسی داخل کد نباید تغییر کند');
    assert.equal(lines[3], 'const msg = "سلام";');
    assert.equal(lines[4], '```');
    assert.notEqual(lines[0], 'سلام این یک تست است');
    assert.notEqual(lines[5], 'پایان');
  });

  it('supports unicode isolate marks mode for BiDi-native terminals', () => {
    const md = 'سلام دنیا\nHello world';
    const out = transformMarkdownRtl(md, 'marks');
    assert.equal(out, '\u2067سلام دنیا\u2069\nHello world');
  });
});
