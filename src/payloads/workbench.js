// rtl-patch v0.1.0 — Trusted-Types-safe RTL direction observer for VS Code & Cursor
(() => {
  if (window.__RTL_PATCH_ACTIVE__) return;
  window.__RTL_PATCH_ACTIVE__ = true;

  const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const STRONG_LTR_RE = /[A-Za-z]/;

  // Containers where AI chat / markdown prose lives
  const CHAT_CONTAINER_SELECTOR = [
    '.interactive-session',
    '.interactive-item-container',
    '.chat-markdown-part',
    '.chat-input-container',
    '.anysphere-markdown-container-root',
    '.composer-human-message',
    '.composer-message',
    '.aislash-editor-input',
    '.markdown-root',
  ].join(',');

  // Prose elements inside chat containers
  const PROSE_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, textarea, [contenteditable="true"]';

  // Code / technical elements that MUST remain LTR
  const LTR_PROTECTED_SELECTOR = 'pre, code, kbd, samp, .monaco-editor, .monaco-diff-editor, .interactive-result-code-block, .xterm';

  function detectDirection(text) {
    if (!text) return null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (RTL_RE.test(ch)) return 'rtl';
      if (STRONG_LTR_RE.test(ch)) return 'ltr';
    }
    return null;
  }

  function isInsideCodeEditor(el) {
    // Protect main code editors and code blocks, but allow chat input textareas/contenteditable
    const editor = el.closest('.monaco-editor');
    if (!editor) return false;
    return !editor.closest('.interactive-input-part, .chat-input-container, .aislash-editor-input');
  }

  function processElement(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.matches(LTR_PROTECTED_SELECTOR) || el.closest('pre, code')) {
      if (el.getAttribute('dir') !== 'ltr') {
        el.setAttribute('dir', 'ltr');
        el.setAttribute('data-rtl-patch', 'ltr');
      }
      return;
    }

    if (isInsideCodeEditor(el)) return;

    const isInput = el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true';
    const text = isInput ? (el.value ?? el.textContent ?? '') : (el.textContent ?? '');
    const dir = detectDirection(text.trim());

    if (dir === 'rtl') {
      if (el.getAttribute('dir') !== 'rtl') {
        el.setAttribute('dir', 'rtl');
        el.setAttribute('data-rtl-patch', 'rtl');
      }
    } else if (isInput) {
      if (el.getAttribute('dir') !== 'auto') {
        el.setAttribute('dir', 'auto');
        el.setAttribute('data-rtl-patch', 'auto');
      }
    } else if (el.getAttribute('data-rtl-patch') === 'rtl') {
      el.setAttribute('dir', 'auto');
      el.setAttribute('data-rtl-patch', 'auto');
    }
  }

  function scanRoot(root) {
    if (!(root instanceof HTMLElement || root instanceof Document)) return;

    const containers =
      root instanceof HTMLElement && root.matches(CHAT_CONTAINER_SELECTOR)
        ? [root]
        : Array.from(root.querySelectorAll(CHAT_CONTAINER_SELECTOR));

    for (const container of containers) {
      const proseNodes = container.querySelectorAll(PROSE_SELECTOR);
      for (const node of proseNodes) {
        processElement(node);
      }
      const codeNodes = container.querySelectorAll(LTR_PROTECTED_SELECTOR);
      for (const node of codeNodes) {
        if (node instanceof HTMLElement && !node.closest('.interactive-input-part')) {
          node.setAttribute('dir', 'ltr');
          node.setAttribute('data-rtl-patch', 'ltr');
        }
      }
    }
  }

  let scheduled = false;
  const pendingRoots = new Set();

  function scheduleScan(node) {
    pendingRoots.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      for (const r of roots) {
        if (r.isConnected) {
          if (r instanceof HTMLElement && r.closest(CHAT_CONTAINER_SELECTOR)) {
            if (r.matches(PROSE_SELECTOR)) processElement(r);
            scanRoot(r);
          } else {
            scanRoot(r);
          }
        }
      }
    });
  }

  function start() {
    if (!document.body) {
      setTimeout(start, 200);
      return;
    }

    scanRoot(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData' && m.target.parentElement) {
          scheduleScan(m.target.parentElement);
        } else if (m.type === 'childList') {
          for (const added of m.addedNodes) {
            if (added instanceof HTMLElement) {
              scheduleScan(added);
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // React live to user typing in chat input boxes
    document.addEventListener(
      'input',
      (ev) => {
        const target = ev.target;
        if (target instanceof HTMLElement && target.closest(CHAT_CONTAINER_SELECTOR)) {
          processElement(target);
        }
      },
      true,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
