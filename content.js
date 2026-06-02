if (window.__aiqDestroy) window.__aiqDestroy();

  let windowCounter = 0;
  const activeWindows = new Map();
  let pendingSelection = null;
  let globalToolbar = null;
  let lastUrl = location.href;
  let pendingRestoreObserver = null;
  let pendingRestoreTimeout = null;
  let activeDrag = null;
  let spaInterval = null;

  function getPageKey() { return 'aiq_active|' + location.href; }

  // ── 持久化 ──────────────────────────────────────────────────────────────

  function persistWindows() {
    const key = getPageKey();
    const arr = [];
    for (const [, state] of activeWindows) {
      arr.push({
        id: state.id,
        selectedText: state.selectedText,
        history: state.history,
        isDragged: state.isDragged,
        dragOffset: state.dragOffset,
        noLine: state.noLine,
        parentId: state.parentId,
        xCollapsed: state.xCollapsed,
        isMinimized: state.winEl.classList.contains('aiq-minimized'),
      });
    }
    if (arr.length > 0) {
      chrome.storage.local.set({ [key]: arr });
    } else {
      chrome.storage.local.remove(key);
    }
  }

  function restoreWindows() {
    if (pendingRestoreObserver) { pendingRestoreObserver.disconnect(); pendingRestoreObserver = null; }
    if (pendingRestoreTimeout) { clearTimeout(pendingRestoreTimeout); pendingRestoreTimeout = null; }

    const key = getPageKey();
    chrome.storage.local.get(key, (result) => {
      if (getPageKey() !== key) return;
      const saved = result[key];
      if (!saved || !Array.isArray(saved)) return;

      const pending = new Map(topoSort(saved).map((item, idx) => [idx, item]));
      const idMap = new Map();

      function attemptRestore() {
        for (const [idx, item] of [...pending]) {
          if (item.parentId != null && !idMap.has(item.parentId)) continue;
          const range = findTextRange(item.selectedText);
          if (range) {
            pending.delete(idx);
            restoreWindow(item, idx, range, idMap);
          }
        }
        return pending.size === 0;
      }

      if (attemptRestore()) return;

      pendingRestoreObserver = new MutationObserver(() => {
        if (attemptRestore()) {
          pendingRestoreObserver.disconnect();
          pendingRestoreObserver = null;
        }
      });
      pendingRestoreObserver.observe(document.body, { childList: true, subtree: true });

      pendingRestoreTimeout = setTimeout(() => {
        if (getPageKey() !== key) return;
        if (pendingRestoreObserver) { pendingRestoreObserver.disconnect(); pendingRestoreObserver = null; }
        pendingRestoreTimeout = null;
        for (const [idx, item] of pending) restoreWindow(item, idx, null, idMap);
      }, 8000);
    });
  }

  // ── 文字定位 ────────────────────────────────────────────────────────────

  function topoSort(items) {
    const byId = new Map(items.filter(i => i.id != null).map(i => [i.id, i]));
    const out = [], seen = new Set();
    function visit(item) {
      if (seen.has(item)) return;
      seen.add(item);
      if (item.parentId != null && byId.has(item.parentId)) visit(byId.get(item.parentId));
      out.push(item);
    }
    items.forEach(visit);
    return out;
  }

  function findTextRange(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const tag = node.parentElement?.tagName?.toLowerCase();
        if (['script', 'style', 'noscript'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.aiq-wrapper')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let fullText = '';
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: fullText.length });
      fullText += n.textContent;
    }
    const matchStart = fullText.indexOf(text);
    if (matchStart === -1) return null;
    const matchEnd = matchStart + text.length;
    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    for (const item of nodes) {
      const nodeEnd = item.start + item.node.textContent.length;
      if (startNode === null && nodeEnd > matchStart) {
        startNode = item.node;
        startOffset = matchStart - item.start;
      }
      if (startNode !== null && nodeEnd >= matchEnd) {
        endNode = item.node;
        endOffset = matchEnd - item.start;
        break;
      }
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  // ── 恢复窗口 ────────────────────────────────────────────────────────────

  function restoreWindow(item, idx, range, idMap = new Map()) {
    const id = ++windowCounter;

    const highlights = tryHighlight(range ? range.cloneRange() : null, id);
    const highlight = highlights[0] || null;

    const anchor = document.createElement('span');
    anchor.className = 'aiq-anchor';
    anchor.dataset.aiqId = id;
    if (highlight) {
      highlight.prepend(anchor);
    } else {
      anchor.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;';
      document.body.appendChild(anchor);
    }

    const win = buildWindowDOM(id, item.selectedText);
    const wrapper = buildWrapper();
    wrapper.style.left = '-9999px';
    wrapper.appendChild(win);
    document.documentElement.appendChild(wrapper);

    const noHighlight = !highlight;
    const state = {
      id, anchor, highlight, highlights, element: wrapper, winEl: win,
      history: [...(item.history || [])],
      selectedText: item.selectedText,
      isDragged: item.isDragged !== undefined ? item.isDragged : noHighlight,
      dragOffset: item.dragOffset || { x: window.innerWidth - 376, y: 60 + idx * 280 },
      rafPending: false,
      noLine: item.noLine || noHighlight,
      parentId: item.parentId != null ? (idMap.get(item.parentId) ?? null) : null,
      toggleBtn: null,
      xCollapsed: false,
      _colChecked: false, _colEl: null
    };
    activeWindows.set(id, state);
    if (item.id != null) idMap.set(item.id, id);

    applyPosition(state.element, anchor.getBoundingClientRect(), state);

    for (const msg of state.history) appendMessage(id, msg.role, msg.content);
    if (state.history.length > 0 && state.history[state.history.length - 1].role === 'user') {
      addResendButton(id);
    }

    const toggleBtn = buildToggleBtn(id);
    wrapper.appendChild(toggleBtn);
    state.toggleBtn = toggleBtn;
    setupToggleDrag(toggleBtn, wrapper, state);

    if (item.isMinimized || item.xCollapsed) {
      win.style.transition = 'none';
      if (item.isMinimized) {
        win.classList.add('aiq-minimized');
        win.style.height = '42px';
        win.querySelector('.aiq-minimize').textContent = '□';
      }
      toggleBtn.style.display = 'block';
      if (item.xCollapsed) {
        win.style.transform = 'scaleX(0)';
        toggleBtn.style.setProperty('--aiq-rot', 'rotate(90deg)');
        state.xCollapsed = true;
      }
      updateTogglePos(state);
      requestAnimationFrame(() => { win.style.transition = ''; });
    }

    attachScrollResize(state);
    setupWindowEvents(id);
    updateGlobalToolbar();
  }

  // ── 初始化 ──────────────────────────────────────────────────────────────

  (function cleanup() {
    document.querySelectorAll('.aiq-wrapper').forEach(el => el.remove());
    document.querySelectorAll('.aiq-window').forEach(el => el.remove());
    document.querySelectorAll('.aiq-x-toggle').forEach(el => el.remove());
    document.querySelectorAll('.aiq-svg-overlay').forEach(el => el.remove());
    document.querySelectorAll('mark.aiq-highlight').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) { while (mark.firstChild) parent.insertBefore(mark.firstChild, mark); mark.remove(); }
    });
    document.querySelectorAll('.aiq-anchor').forEach(el => el.remove());
  })();

  restoreWindows();

  // ── SPA 导航检测 ──────────────────────────────────────────────────────────

  function clearCurrentWindows() {
    if (pendingRestoreObserver) { pendingRestoreObserver.disconnect(); pendingRestoreObserver = null; }
    if (pendingRestoreTimeout) { clearTimeout(pendingRestoreTimeout); pendingRestoreTimeout = null; }
    for (const [, state] of activeWindows) {
      window.removeEventListener('scroll', state.scrollHandler, { capture: true });
      window.removeEventListener('resize', state.scrollHandler);
      state.element.remove();
      if (state.highlights) {
        state.highlights.forEach(mark => {
          const parent = mark.parentNode;
          if (parent) { while (mark.firstChild) parent.insertBefore(mark.firstChild, mark); mark.remove(); }
        });
      }
      try { state.anchor.remove(); } catch (e) {}
    }
    activeWindows.clear();
    document.querySelectorAll('.aiq-svg-overlay').forEach(el => el.remove());
    updateGlobalToolbar();
  }

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearCurrentWindows();
    restoreWindows();
  }

  window.addEventListener('popstate', onUrlChange);
  spaInterval = setInterval(() => { if (location.href !== lastUrl) onUrlChange(); }, 50);

  const onDocMousedown = (e) => {
    if (e.button !== 2) return;
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) { pendingSelection = null; return; }
    try {
      pendingSelection = { text: sel.toString().trim(), range: sel.getRangeAt(0).cloneRange() };
    } catch (err) { pendingSelection = null; }
  };
  document.addEventListener('mousedown', onDocMousedown, true);

  const onRuntimeMessage = (msg) => {
    if (msg.type !== 'CREATE_WINDOW') return;
    let sel = pendingSelection;
    if (!sel) {
      const domSel = window.getSelection();
      if (domSel && domSel.toString().trim()) {
        try { sel = { text: domSel.toString().trim(), range: domSel.getRangeAt(0).cloneRange() }; } catch (e) {}
      }
    }
    if (!sel && msg.selectionText) sel = { text: msg.selectionText, range: null };
    if (!sel) return;
    createWindow(sel.text, sel.range);
    pendingSelection = null;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  const docMouseMove = (e) => { if (activeDrag) activeDrag.onMove(e); };
  const docMouseUp = () => { if (activeDrag) { activeDrag.onUp(); activeDrag = null; } };
  document.addEventListener('mousemove', docMouseMove, true);
  document.addEventListener('mouseup', docMouseUp, true);

  // ── 创建新窗口 ──────────────────────────────────────────────────────────

  function getContainingAiqWindow(range) {
    if (!range) return null;
    let el = range.commonAncestorContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    return el ? el.closest('.aiq-window') : null;
  }

  function findWindowIdByElement(el) {
    for (const [id, state] of activeWindows) {
      if (state.winEl === el) return id;
    }
    return null;
  }

  function rangeContainsImage(range) {
    if (!range) return false;
    try { return range.cloneContents().querySelector('img') !== null; } catch (e) { return false; }
  }

  function createWindow(selectedText, range) {
    const id = ++windowCounter;

    const parentWinEl = getContainingAiqWindow(range);

    // 嵌套追问：不高亮（避免 mark 套 mark），anchor 挂到父窗口 header
    const highlights = tryHighlight(parentWinEl ? null : (range ? range.cloneRange() : null), id);
    const highlight = highlights[0] || null;

    const anchor = document.createElement('span');
    anchor.className = 'aiq-anchor';
    anchor.dataset.aiqId = id;

    if (parentWinEl) {
      parentWinEl.querySelector('.aiq-header').appendChild(anchor);
    } else if (highlight) {
      highlight.prepend(anchor);
    } else {
      try {
        const r = range ? range.cloneRange() : null;
        if (!r) throw new Error('no range');
        r.collapse(true);
        r.insertNode(anchor);
      } catch (e) {
        const fallback = findTextRange(selectedText);
        if (fallback) {
          try { const r2 = fallback.cloneRange(); r2.collapse(true); r2.insertNode(anchor); }
          catch (e2) { document.body.appendChild(anchor); }
        } else {
          document.body.appendChild(anchor);
        }
      }
    }

    const win = buildWindowDOM(id, selectedText);
    const wrapper = buildWrapper();
    wrapper.appendChild(win);
    document.documentElement.appendChild(wrapper);

    // 嵌套时：定位在父窗口旁边，不画连线
    let initIsDragged = false;
    let initDragOffset = { x: 0, y: 0 };
    let parentId = null;
    if (parentWinEl) {
      parentId = findWindowIdByElement(parentWinEl);
      const parentRect = parentWinEl.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const W = 360, MARGIN = 16;
      let initLeft;
      if (parentRect.right + MARGIN + W <= vw - 8) {
        initLeft = parentRect.right + MARGIN;
      } else if (parentRect.left - W - MARGIN >= 8) {
        initLeft = parentRect.left - W - MARGIN;
      } else {
        initLeft = vw - W - 8;
      }
      initIsDragged = true;
      initDragOffset = { x: initLeft - anchorRect.left, y: parentRect.top + 30 - anchorRect.top };
    }

    const state = {
      id, anchor, highlight, highlights, element: wrapper, winEl: win,
      history: [],
      selectedText,
      isDragged: initIsDragged,
      dragOffset: initDragOffset,
      rafPending: false,
      noLine: !!parentWinEl,
      parentId,
      toggleBtn: null,
      xCollapsed: false,
      _colChecked: false, _colEl: null
    };
    activeWindows.set(id, state);

    const toggleBtn = buildToggleBtn(id);
    wrapper.appendChild(toggleBtn);
    state.toggleBtn = toggleBtn;
    setupToggleDrag(toggleBtn, wrapper, state);

    applyPosition(wrapper, anchor.getBoundingClientRect(), state);
    attachScrollResize(state);
    setupWindowEvents(id);
    if (rangeContainsImage(range)) {
      appendMessage(id, 'assistant', '⚠ 选区含有图片，暂不支持图片内容，已自动忽略。');
    }
    persistWindows();
    updateGlobalToolbar();
  }

  // ── 工具函数 ─────────────────────────────────────────────────────────────

  function buildWrapper() {
    const el = document.createElement('div');
    el.className = 'aiq-wrapper';
    return el;
  }

  function buildToggleBtn(id) {
    const btn = document.createElement('button');
    btn.className = 'aiq-x-toggle';
    btn.textContent = '▲';
    btn.style.cssText = 'display:none;padding:2px;font-size:10px;line-height:1;';
    btn.style.setProperty('--aiq-rot', 'rotate(-90deg)');
    btn.addEventListener('click', () => { toggleXCollapse(id); btn.blur(); });
    return btn;
  }

  function tryReanchor(state) {
    if (state.noLine) return false;
    const now = Date.now();
    if (state._reanchorUntil && now < state._reanchorUntil) return false;
    state._reanchorUntil = now + 2000;
    document.querySelectorAll(`mark.aiq-highlight[data-aiq-id="${state.id}"]`).forEach(m => {
      const p = m.parentNode;
      if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); }
    });
    const range = findTextRange(state.selectedText);
    if (!range) return false;
    const newHighlights = tryHighlight(range.cloneRange(), state.id);
    if (newHighlights.length > 0) {
      state.highlights = newHighlights;
      state.highlight = newHighlights[0];
      newHighlights[0].prepend(state.anchor);
    } else {
      try { const r = range.cloneRange(); r.collapse(true); r.insertNode(state.anchor); } catch (e) { return false; }
      state.highlight = null;
      state.highlights = [];
    }
    return state.anchor.isConnected;
  }

  function attachScrollResize(state) {
    const scrollHandler = () => {
      if (state.rafPending) return;
      if (!state.anchor.isConnected && !tryReanchor(state)) return;
      state.rafPending = true;
      requestAnimationFrame(() => {
        state.rafPending = false;
        if (!state.anchor.isConnected) return;
        applyPosition(state.element, state.anchor.getBoundingClientRect(), state);
      });
    };
    window.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    window.addEventListener('resize', scrollHandler, { passive: true });
    state.scrollHandler = scrollHandler;
  }

  function tryHighlight(range, id) {
    if (!range) return [];
    try {
      const ancestor = range.commonAncestorContainer;
      if (ancestor.nodeType === Node.TEXT_NODE) {
        const mark = document.createElement('mark');
        mark.className = 'aiq-highlight';
        mark.dataset.aiqId = id;
        range.surroundContents(mark);
        return [mark];
      }
      const textNodes = [];
      const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const nr = document.createRange();
        nr.selectNodeContents(node);
        if (nr.compareBoundaryPoints(Range.END_TO_START, range) >= 0) continue;
        if (nr.compareBoundaryPoints(Range.START_TO_END, range) <= 0) continue;
        textNodes.push(node);
      }
      const marks = [];
      for (const textNode of textNodes) {
        const nr = document.createRange();
        nr.selectNodeContents(textNode);
        if (textNode === range.startContainer) nr.setStart(textNode, range.startOffset);
        if (textNode === range.endContainer) nr.setEnd(textNode, range.endOffset);
        if (nr.collapsed) continue;
        const mark = document.createElement('mark');
        mark.className = 'aiq-highlight';
        mark.dataset.aiqId = id;
        nr.surroundContents(mark);
        marks.push(mark);
      }
      return marks;
    } catch (e) {
      document.querySelectorAll(`mark.aiq-highlight[data-aiq-id="${id}"]`).forEach(m => {
        const p = m.parentNode;
        if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); }
      });
      return [];
    }
  }

  // ── 定位 ─────────────────────────────────────────────────────────────────

  const BLOCK_TAGS = new Set(['P','DIV','ARTICLE','SECTION','MAIN','BLOCKQUOTE','LI','TD','TH','HEADER','FOOTER','NAV','ASIDE']);

  function getContentColumnEl(anchor) {
    const vw = window.innerWidth;
    let el = anchor.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName)) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= vw * 0.25 && rect.width <= vw * 0.9) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function applyPosition(win, anchorRect, state) {
    const W = 360, MARGIN = 16;
    let left, top;

    if (state.isDragged) {
      left = anchorRect.left + state.dragOffset.x;
      top  = anchorRect.top  + state.dragOffset.y;
    } else {
      const vw = window.innerWidth;
      // 退化矩形：anchor 不在可见流中（如 SPA body 高度为 0），用安全默认位置
      const degenerate = anchorRect.top === 0 && anchorRect.left === 0 &&
                         anchorRect.width === 0 && anchorRect.height === 0;
      top = degenerate ? 80 : anchorRect.top;

      if (!state._colChecked) {
        state._colEl = getContentColumnEl(state.anchor);
        state._colChecked = true;
      }
      const col = state._colEl ? state._colEl.getBoundingClientRect() : null;

      if (col) {
        const rightSpace = vw - col.right - 8;
        const leftSpace  = col.left - 8;
        if (rightSpace >= W + MARGIN) {
          left = col.right + MARGIN;
        } else if (leftSpace >= W + MARGIN) {
          left = col.left - W - MARGIN;
        } else {
          left = vw - W - 8;
        }
      } else if (!degenerate && anchorRect.right + MARGIN + W <= vw - 8) {
        left = anchorRect.right + MARGIN;
      } else if (!degenerate && anchorRect.left - W - MARGIN >= 8) {
        left = anchorRect.left - W - MARGIN;
      } else {
        left = vw - W - 8;
      }
    }

    win.style.left = left + 'px';
    win.style.top  = top  + 'px';

    updateTogglePos(state);
  }

  function buildWindowDOM(id, selectedText) {
    const el = document.createElement('div');
    el.className = 'aiq-window';
    el.id = `aiq-win-${id}`;
    const firstLine = selectedText.split(/[\n\r]+/).map(s => s.trim()).find(s => s.length > 0) || selectedText;
    const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
    el.innerHTML = `
      <div class="aiq-header">
        <span class="aiq-title" title="${escHtml(selectedText)}">${escHtml(preview)}</span>
        <div class="aiq-header-btns">
          <span class="aiq-minimize" role="button" tabindex="0" title="最小化">−</span>
          <span class="aiq-close" role="button" tabindex="0" title="关闭">×</span>
        </div>
      </div>
      <div class="aiq-messages" id="aiq-msgs-${id}"></div>
      <div class="aiq-input-area">
        <textarea class="aiq-input" placeholder="输入追问，Enter 发送，Shift+Enter 换行" rows="2"></textarea>
        <button class="aiq-send">发送</button>
      </div>
    `;
    return el;
  }

  function setupWindowEvents(id) {
    const state = activeWindows.get(id);
    const win = state.winEl;
    const closeEl = win.querySelector('.aiq-close');
    const minimizeEl = win.querySelector('.aiq-minimize');
    closeEl.addEventListener('click', () => closeWindow(id));
    closeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeWindow(id); } });
    minimizeEl.addEventListener('click', () => toggleMinimize(id));
    minimizeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMinimize(id); } });
    win.querySelector('.aiq-send').addEventListener('click', () => sendMessage(id));
    win.querySelector('.aiq-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(id); }
    });
    setupDrag(state.element, win.querySelector('.aiq-header'), state);

    const hlOn  = () => state.highlights?.forEach(m => m.classList.add('aiq-highlight-active'));
    const hlOff = () => state.highlights?.forEach(m => m.classList.remove('aiq-highlight-active'));
    win.addEventListener('mouseenter', hlOn);
    win.addEventListener('mouseleave', hlOff);
    state.toggleBtn.addEventListener('mouseenter', hlOn);
    state.toggleBtn.addEventListener('mouseleave', hlOff);
  }

  function setupDrag(win, handle, state) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, .aiq-minimize, .aiq-close')) return;
      startX = e.clientX; startY = e.clientY;
      startLeft = parseInt(win.style.left) || 0;
      startTop  = parseInt(win.style.top)  || 0;
      activeDrag = {
        onMove(e) {
          const newLeft = startLeft + e.clientX - startX;
          const newTop  = startTop  + e.clientY - startY;
          win.style.left = newLeft + 'px';
          win.style.top  = newTop  + 'px';
          const anchorRect = state.anchor.getBoundingClientRect();
          state.isDragged = true;
          state.dragOffset = { x: newLeft - anchorRect.left, y: newTop - anchorRect.top };
          updateTogglePos(state);
        },
        onUp() { persistWindows(); }
      };
      e.preventDefault();
    });
  }

  function setupToggleDrag(toggleBtn, win, state) {
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    toggleBtn.addEventListener('mousedown', (e) => {
      hasMoved = false;
      startX = e.clientX; startY = e.clientY;
      startLeft = parseInt(win.style.left) || 0;
      startTop  = parseInt(win.style.top)  || 0;
      activeDrag = {
        onMove(e) {
          const dx = e.clientX - startX, dy = e.clientY - startY;
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          hasMoved = true;
          const newLeft = startLeft + dx, newTop = startTop + dy;
          win.style.left = newLeft + 'px';
          win.style.top  = newTop  + 'px';
          const anchorRect = state.anchor.getBoundingClientRect();
          state.isDragged = true;
          state.dragOffset = { x: newLeft - anchorRect.left, y: newTop - anchorRect.top };
          updateTogglePos(state);
        },
        onUp() { if (hasMoved) persistWindows(); }
      };
      toggleBtn.style.cursor = '';
      e.preventDefault();
    });

    toggleBtn.addEventListener('click', (e) => {
      if (hasMoved) { e.stopImmediatePropagation(); hasMoved = false; }
    }, true);
  }

  function toggleMinimize(id) {
    const state = activeWindows.get(id);
    if (!state) return;
    const win = state.winEl;
    const btn = win.querySelector('.aiq-minimize');

    if (win.classList.contains('aiq-minimized')) {
      if (state.xCollapsed) {
        state.xCollapsed = false;
        win.style.transform = '';
        state.toggleBtn.textContent = '▲';
        state.toggleBtn.style.setProperty('--aiq-rot', 'rotate(-90deg)');
      }
      win.style.height = '42px';
      win.classList.remove('aiq-minimized');
      const expandedH = win.scrollHeight;
      void win.offsetHeight;
      win.style.height = expandedH + 'px';
      btn.textContent = '−';
      state.toggleBtn.style.display = 'none';
      persistWindows();
      const onEnd = (e) => {
        if (e.propertyName !== 'height') return;
        win.removeEventListener('transitionend', onEnd);
        win.style.height = '';
      };
      win.addEventListener('transitionend', onEnd);
    } else {
      win.style.height = win.offsetHeight + 'px';
      void win.offsetHeight;
      win.classList.add('aiq-minimized');
      win.style.height = '42px';
      btn.textContent = '□';
      state.toggleBtn.style.display = 'block';
      updateTogglePos(state);
      persistWindows();
    }
  }

  function toggleXCollapse(id) {
    const state = activeWindows.get(id);
    if (!state) return;
    const win = state.winEl;
    const btn = state.toggleBtn;

    if (!state.xCollapsed) {
      win.style.transform = 'scaleX(0)';
      btn.style.setProperty('--aiq-rot', 'rotate(90deg)');
      state.xCollapsed = true;
      persistWindows();
    } else {
      win.style.transform = 'scaleX(1)';
      btn.style.setProperty('--aiq-rot', 'rotate(-90deg)');
      state.xCollapsed = false;
      persistWindows();
      const onEnd = (e) => {
        if (e.propertyName !== 'transform') return;
        win.removeEventListener('transitionend', onEnd);
        win.style.transform = '';
        updateTogglePos(state);
      };
      win.addEventListener('transitionend', onEnd);
    }
    trackToggleAnim(state, 350);
  }

  function trackToggleAnim(state, durationMs) {
    const start = performance.now();
    function step(now) {
      updateTogglePos(state);
      if (now - start < durationMs) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function updateTogglePos(state) {
    const btn = state.toggleBtn;
    if (!btn || btn.style.display === 'none') return;
    const wRect = state.winEl.getBoundingClientRect();
    const wrapRect = state.element.getBoundingClientRect();
    btn.style.left = (Math.max(wRect.right - wrapRect.left, 0) + 4) + 'px';
    btn.style.top = '14px';
  }

  function closeWindow(id) {
    const state = activeWindows.get(id);
    if (!state) return;
    const children = [...activeWindows.keys()].filter(cid => activeWindows.get(cid).parentId === id);
    children.forEach(cid => closeWindow(cid));
    window.removeEventListener('scroll', state.scrollHandler, { capture: true });
    window.removeEventListener('resize', state.scrollHandler);
    state.element.remove();
    if (state.highlights && state.highlights.length > 0) {
      state.highlights.forEach(mark => {
        const parent = mark.parentNode;
        if (parent) { while (mark.firstChild) parent.insertBefore(mark.firstChild, mark); mark.remove(); }
      });
    }
    try { state.anchor.remove(); } catch (e) {}
    activeWindows.delete(id);
    if (activeWindows.size === 0) {
      if (pendingRestoreObserver) { pendingRestoreObserver.disconnect(); pendingRestoreObserver = null; }
      if (pendingRestoreTimeout) { clearTimeout(pendingRestoreTimeout); pendingRestoreTimeout = null; }
    }
    persistWindows();
    updateGlobalToolbar();
  }

  async function sendMessage(id) {
    const state = activeWindows.get(id);
    if (!state) return;
    const input = state.winEl.querySelector('.aiq-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    appendMessage(id, 'user', text);
    state.history.push({ role: 'user', content: text });
    persistWindows();
    await executeApiCall(id);
  }

  async function executeApiCall(id) {
    const state = activeWindows.get(id);
    if (!state || state.loading) return;
    state.loading = true;
    setInputEnabled(id, false);
    const loadingEl = appendMessage(id, 'assistant', '▋');

    const settings = await getSettings();
    if (!settings.apiKey) {
      updateMessage(loadingEl, '⚠ 请先点击插件图标，配置 API Key');
      const s0 = activeWindows.get(id);
      if (s0) { s0.loading = false; setInputEnabled(id, true); }
      return;
    }

    const systemPrompt = `你是一个学习助手。用户正在阅读AI回答，对其中某段内容有疑问。被选中的原文如下：\n\n"${state.selectedText}"\n\n请针对这个上下文，简洁准确地回答用户的追问。`;

    let fullContent = '';
    try {
      let stream;
      if (settings.provider === 'openai') {
        const base = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        const msgs = [{ role: 'system', content: systemPrompt }, ...state.history];
        stream = streamOpenAI(base, settings.apiKey, settings.model, msgs);
      } else if (settings.provider === 'anthropic') {
        const base = (settings.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
        stream = streamAnthropic(base, settings.apiKey, settings.model, state.history, systemPrompt);
      } else {
        throw new Error('未知的 AI 提供商');
      }

      for await (const chunk of stream) {
        if (!activeWindows.has(id)) break;
        fullContent += chunk;
        updateMessage(loadingEl, fullContent + '▋');
      }

      if (!activeWindows.has(id)) return;
      updateMessage(loadingEl, fullContent || '⚠ 未收到回复');
      if (fullContent) {
        state.history.push({ role: 'assistant', content: fullContent });
        saveHistory(id);
        persistWindows();
      }
    } catch (err) {
      if (activeWindows.has(id)) {
        updateMessage(loadingEl, `❌ ${err.message}`);
        addResendButton(id);
      }
    }
    const s = activeWindows.get(id);
    if (s) { s.loading = false; setInputEnabled(id, true); }
  }

  async function* streamOpenAI(base, apiKey, model, messages) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim();
          if (d === '[DONE]') return;
          try {
            const delta = JSON.parse(d).choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch (_) {}
        }
      }
    } finally { reader.cancel(); }
  }

  async function* streamAnthropic(base, apiKey, model, messages, system) {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, messages, system, max_tokens: 2048, stream: true })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim();
          try {
            const ev = JSON.parse(d);
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              yield ev.delta.text;
            }
          } catch (_) {}
        }
      }
    } finally { reader.cancel(); }
  }

  function addResendButton(id) {
    const msgs = document.getElementById(`aiq-msgs-${id}`);
    if (!msgs) return;
    const btn = document.createElement('button');
    btn.className = 'aiq-resend';
    btn.textContent = '↺ 重新发送';
    btn.addEventListener('click', () => {
      btn.remove();
      const bubbles = [...msgs.children];
      const lastUserIdx = bubbles.map(b => b.classList.contains('aiq-msg-user')).lastIndexOf(true);
      const trailing = lastUserIdx >= 0 ? bubbles.slice(lastUserIdx + 1).find(b => b.classList.contains('aiq-msg-assistant')) : null;
      if (trailing) trailing.remove();
      executeApiCall(id);
    });
    msgs.appendChild(btn);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── 全局工具栏：排序 + 全部删除 ─────────────────────────────────────────

  function getAnchorDocY(state) {
    if (state.parentId != null) {
      const parent = activeWindows.get(state.parentId);
      return parent ? getAnchorDocY(parent) : 0;
    }
    if (state.noLine) {
      const t = parseFloat(state.element.style.top);
      return (isNaN(t) ? state.element.getBoundingClientRect().top : t) + window.scrollY;
    }
    return state.anchor.getBoundingClientRect().top + window.scrollY;
  }

  function setWindowPos(state, left, top) {
    state.element.style.left = left + 'px';
    state.element.style.top  = top  + 'px';
    const aRect = state.anchor.getBoundingClientRect();
    state.isDragged = true;
    state.dragOffset = { x: left - aRect.left, y: top - aRect.top };
    updateTogglePos(state);
  }

  function sortWindows() {
    const allStates = [...activeWindows.values()];
    const roots = allStates.filter(s => s.parentId == null);
    roots.sort((a, b) => getAnchorDocY(a) - getAnchorDocY(b));

    const GAP = 8;
    const sy = window.scrollY;

    // Ideal position in document Y (scroll-invariant)
    const idealDocY = roots.map(s => {
      if (!s.noLine && s.anchor.isConnected) return s.anchor.getBoundingClientRect().top + sy;
      return (parseFloat(s.element.style.top) || 0) + sy;
    });

    // Resolve overlaps in document Y space
    const docY = [...idealDocY];
    for (let i = 1; i < roots.length; i++) {
      const prevBottom = docY[i - 1] + (roots[i - 1].winEl.offsetHeight || 200) + GAP;
      if (docY[i] < prevBottom) docY[i] = prevBottom;
    }

    roots.forEach((state, i) => {
      const viewportTop = docY[i] - sy;
      const delta = viewportTop - (parseFloat(state.element.style.top) || 0);
      setWindowPos(state, parseInt(state.element.style.left) || 0, viewportTop);
      allStates.filter(s => s.parentId === state.id).forEach(child => {
        setWindowPos(child, parseInt(child.element.style.left) || 0, (parseFloat(child.element.style.top) || 0) + delta);
      });
    });

    persistWindows();
  }

  function updateGlobalToolbar() {
    if (activeWindows.size === 0) {
      if (globalToolbar) globalToolbar.style.display = 'none';
      return;
    }
    if (!globalToolbar) {
      globalToolbar = document.createElement('div');
      globalToolbar.className = 'aiq-global-toolbar';

      const sortBtn = document.createElement('button');
      sortBtn.className = 'aiq-tb-btn';
      sortBtn.textContent = '↕ 排序';
      sortBtn.title = '按原文顺序从上到下排列';
      sortBtn.addEventListener('click', sortWindows);

      const delBtn = document.createElement('button');
      delBtn.className = 'aiq-tb-btn aiq-tb-del';
      delBtn.textContent = '× 全部删除';
      delBtn.title = '删除所有追问框';
      delBtn.addEventListener('click', () => {
        if (!confirm('确定删除全部追问框？此操作不可撤销。')) return;
        if (pendingRestoreObserver) { pendingRestoreObserver.disconnect(); pendingRestoreObserver = null; }
        if (pendingRestoreTimeout) { clearTimeout(pendingRestoreTimeout); pendingRestoreTimeout = null; }
        for (const id of [...activeWindows.keys()]) closeWindow(id);
        // 清理未被追踪的遗留 DOM（旧版本残留）
        document.querySelectorAll('.aiq-wrapper, .aiq-window, .aiq-x-toggle, .aiq-anchor, .aiq-svg-overlay').forEach(el => el.remove());
        document.querySelectorAll('mark.aiq-highlight').forEach(mark => {
          const p = mark.parentNode;
          if (p) { while (mark.firstChild) p.insertBefore(mark.firstChild, mark); mark.remove(); }
        });
      });

      globalToolbar.appendChild(sortBtn);
      globalToolbar.appendChild(delBtn);
      document.documentElement.appendChild(globalToolbar);
    }
    globalToolbar.style.display = '';
  }

  // ── 辅助函数 ─────────────────────────────────────────────────────────────

  function appendMessage(id, role, content) {
    const msgs = document.getElementById(`aiq-msgs-${id}`);
    if (!msgs) return document.createElement('div');
    const el = document.createElement('div');
    el.className = `aiq-msg aiq-msg-${role}`;
    setMessageContent(el, role, content);
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function updateMessage(el, content) {
    const role = el.classList.contains('aiq-msg-assistant') ? 'assistant' : 'user';
    setMessageContent(el, role, content);
    const msgs = el.closest('.aiq-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function setMessageContent(el, role, content) {
    if (role === 'assistant') {
      const text = String(content);
      // 流式输出末尾的光标 ▋ 单独处理，避免参与 markdown 解析
      const hasCursor = text.endsWith('▋');
      const body = hasCursor ? text.slice(0, -1) : text;
      el.innerHTML = renderMarkdown(body) + (hasCursor ? '<span class="aiq-cursor">▋</span>' : '');
    } else {
      el.textContent = content;
    }
  }

  // 轻量 markdown 渲染器：先转义 HTML，再按块/行内规则替换。
  // 支持：代码块 ```、行内代码 `、标题 # ~ ######、粗体 **、斜体 *、
  // 删除线 ~~、链接 [text](url)（仅 http/https）、有序/无序列表、引用 >、分隔线 ---、段落与换行。
  function renderMarkdown(src) {
    if (!src) return '';
    // 占位符使用 PUA 字符，避免与正文文本冲突
    const CB_O = '\uE000', CB_C = '\uE001';
    const IC_O = '\uE002', IC_C = '\uE003';

    // 1) 抽出代码块占位
    const codeBlocks = [];
    let s = src.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = codeBlocks.length;
      codeBlocks.push({ lang, code });
      return '\n' + CB_O + i + CB_C + '\n';
    });

    // 2) 全局 HTML 转义
    s = escHtml(s);

    // 3) 抽出行内代码占位
    const inlineCodes = [];
    s = s.replace(/`([^`\n]+?)`/g, (_, code) => {
      const i = inlineCodes.length;
      inlineCodes.push(code);
      return IC_O + i + IC_C;
    });

    // 4) 按行处理块级元素
    const lines = s.split('\n');
    const out = [];
    const cbLineRe = new RegExp('^' + CB_O + '(\\d+)' + CB_C + '$');
    let i2 = 0;
    while (i2 < lines.length) {
      const line = lines[i2];

      // 标题
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const level = h[1].length;
        out.push('<h' + level + ' class="aiq-md-h">' + inlineFormat(h[2]) + '</h' + level + '>');
        i2++;
        continue;
      }

      // 代码块占位（独占一行）
      const cbm = cbLineRe.exec(line);
      if (cbm) {
        const { lang, code } = codeBlocks[+cbm[1]];
        const attr = lang ? ' data-lang="' + escHtml(lang) + '"' : '';
        out.push('<pre class="aiq-md-pre"' + attr + '><code>' + escHtml(code.replace(/\n$/, '')) + '</code></pre>');
        i2++;
        continue;
      }

      // 分隔线
      if (/^\s*[-*_]{3,}\s*$/.test(line)) {
        out.push('<hr class="aiq-md-hr">');
        i2++;
        continue;
      }

      // 引用块
      if (/^&gt;\s?/.test(line)) {
        const buf = [];
        while (i2 < lines.length && /^&gt;\s?/.test(lines[i2])) {
          buf.push(lines[i2].replace(/^&gt;\s?/, ''));
          i2++;
        }
        out.push('<blockquote class="aiq-md-quote">' + inlineFormat(buf.join('<br>')) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i2 < lines.length && /^\s*[-*+]\s+/.test(lines[i2])) {
          items.push(lines[i2].replace(/^\s*[-*+]\s+/, ''));
          i2++;
        }
        out.push('<ul class="aiq-md-ul">' + items.map(t => '<li>' + inlineFormat(t) + '</li>').join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i2 < lines.length && /^\s*\d+\.\s+/.test(lines[i2])) {
          items.push(lines[i2].replace(/^\s*\d+\.\s+/, ''));
          i2++;
        }
        out.push('<ol class="aiq-md-ol">' + items.map(t => '<li>' + inlineFormat(t) + '</li>').join('') + '</ol>');
        continue;
      }

      // 段落
      if (line.trim() === '') {
        out.push('');
        i2++;
        continue;
      }
      const para = [line];
      i2++;
      while (i2 < lines.length && lines[i2].trim() !== '' &&
             !/^(#{1,6})\s+/.test(lines[i2]) &&
             !/^\s*[-*+]\s+/.test(lines[i2]) &&
             !/^\s*\d+\.\s+/.test(lines[i2]) &&
             !/^&gt;\s?/.test(lines[i2]) &&
             !/^\s*[-*_]{3,}\s*$/.test(lines[i2]) &&
             !cbLineRe.test(lines[i2])) {
        para.push(lines[i2]);
        i2++;
      }
      out.push('<p class="aiq-md-p">' + inlineFormat(para.join('<br>')) + '</p>');
    }

    let html = out.filter(x => x !== '').join('');

    // 5) 还原行内代码
    const icRe = new RegExp(IC_O + '(\\d+)' + IC_C, 'g');
    html = html.replace(icRe, (_, n) => {
      return '<code class="aiq-md-code">' + escHtml(inlineCodes[+n]) + '</code>';
    });

    return html;
  }

  function inlineFormat(s) {
    // 链接 [text](url)，仅允许 http/https/相对路径开头，防 javascript:
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
      if (!/^(https?:\/\/|\/|#)/i.test(url)) return m;
      return `<a class="aiq-md-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
    // 粗体 **x** / __x__
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    // 斜体 *x* / _x_（避免吃掉粗体已替换的标签）
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    // 删除线 ~~x~~
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return s;
  }

  function setInputEnabled(id, enabled) {
    const state = activeWindows.get(id);
    if (!state) return;
    state.winEl.querySelector('.aiq-input').disabled = !enabled;
    state.winEl.querySelector('.aiq-send').disabled = !enabled;
    if (enabled) state.winEl.querySelector('.aiq-input').focus();
  }

  function saveHistory(id) {
    const state = activeWindows.get(id);
    if (!state || state.history.length === 0) return;
    const key = `aiq_${Date.now()}_${id}`;
    chrome.storage.local.set({
      [key]: {
        url: location.href,
        title: document.title,
        selectedText: state.selectedText,
        history: state.history,
        savedAt: Date.now()
      }
    });
  }

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(['provider', 'apiKey', 'model', 'baseUrl'], (data) => {
        resolve({
          provider: data.provider || 'openai',
          apiKey: data.apiKey || '',
          model: data.model || 'deepseek-chat',
          baseUrl: data.baseUrl || ''
        });
      });
    });
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.__aiqDestroy = function() {
    clearCurrentWindows();
    window.removeEventListener('popstate', onUrlChange);
    clearInterval(spaInterval);
    document.removeEventListener('mousedown', onDocMousedown, true);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    document.removeEventListener('mousemove', docMouseMove, true);
    document.removeEventListener('mouseup', docMouseUp, true);
    if (globalToolbar) { globalToolbar.remove(); globalToolbar = null; }
    window.__aiqDestroy = null;
  };

