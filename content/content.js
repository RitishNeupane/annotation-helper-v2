// content.js - mySecondTeacher Annotation Helper Content Script (v1.6.0)

(function () {
  'use strict';

  // --- Extension Settings Defaults ---
  let settings = {
    enabled: true,
    shortcutSpace: true,
    shortcutNumbers: true,
    shortcutBrackets: true,
    shortcutAudioEnd: true,
    shortcutPageNav: true,
    shortcutSave: true,
    shortcutSeek: true,
    shortcutSpeed: true,
    showFloatingButton: true,
    deadlineMode: false,
    deadlineDelay: 0.0,
    seekStep: 5,
    speedStep: 0.5,
    autoUpdate: false,
    showToast: true,
    precision: 3
  };

  // --- Extension State ---
  let selectedIndex = 1; // 1-based index of selected card
  let hudContainer = null;
  let timingModalContainer = null;
  let scannedTimings = []; // Array of { originalIndex, startTime, endTime, duration }
  let reorderedTimings = []; // Working array of timings currently arranged by the user

  // --- Load Settings ---
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings, (items) => {
      if (items) {
        settings = { ...settings, ...items };
      }
      initExtension();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (let key in changes) {
          settings[key] = changes[key].newValue;
        }
        updateSelectionHighlight();
        updateFloatingButtonVisibility();
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.action === 'openTimingManager') {
        openTimingManagerModal();
        sendResponse({ success: true });
      } else if (message && message.action === 'openHtmlParser') {
        openHtmlParserModal();
        sendResponse({ success: true });
      }
    });
  } else {
    initExtension();
  }

  function initExtension() {
    createHudContainer();
    createFloatingLauncherButton();
    document.addEventListener('keydown', handleKeyDown, true);
    setTimeout(updateSelectionHighlight, 1000);
  }

  // --- Blur Active Focus Helper ---
  function blurActiveElement() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
  }

  // --- HUD Toast Notification ---
  function createHudContainer() {
    if (document.getElementById('mst-hud-container')) {
      hudContainer = document.getElementById('mst-hud-container');
      return;
    }
    hudContainer = document.createElement('div');
    hudContainer.id = 'mst-hud-container';
    document.body.appendChild(hudContainer);
  }

  function showToast(icon, message, highlightText = '') {
    if (!settings.showToast) return;
    createHudContainer();

    const toast = document.createElement('div');
    toast.className = 'mst-hud-toast';

    let html = `<span class="mst-hud-icon">${icon}</span><span class="mst-hud-text">${message}</span>`;
    if (highlightText) {
      html += `<span class="mst-hud-highlight"> ${highlightText}</span>`;
    }
    toast.innerHTML = html;

    hudContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 250);
    }, 1800);
  }

  // --- Helper to Check Active Input Fields ---
  function isInputActive(e) {
    const el = e.target || document.activeElement;
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    // If typing in a text field that is NOT start/end time (e.g. Section Title)
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && el.type === 'text')) {
      return true;
    }
    if (el.isContentEditable) {
      return true;
    }
    return false;
  }

  // --- Main Audio Player Locator ---
  function getMainAudioElement() {
    const allAudios = Array.from(document.querySelectorAll('audio'));
    if (allAudios.length === 0) return null;

    // Filter out audios inside an annotation card container
    const mainAudios = allAudios.filter(audio => {
      let parent = audio.parentElement;
      while (parent && parent !== document.body) {
        if (parent.querySelector('input[name="startTime"]') || parent.querySelector('input[name="endTime"]')) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });

    if (mainAudios.length > 0) {
      return mainAudios[0];
    }
    return allAudios[0];
  }

  // --- Get Main Audio Total Duration / End Time Helper ---
  function getMainAudioDuration(mainAudio) {
    if (mainAudio && !isNaN(mainAudio.duration) && isFinite(mainAudio.duration) && mainAudio.duration > 0) {
      return mainAudio.duration;
    }

    // Fallback 1: Check aria-valuemax on main slider thumb
    const sliderThumb = document.querySelector('.MuiSlider-thumb[aria-valuemax]');
    if (sliderThumb) {
      const maxVal = parseFloat(sliderThumb.getAttribute('aria-valuemax'));
      if (!isNaN(maxVal) && maxVal > 0) return maxVal;
    }

    // Fallback 2: Check input max on range slider
    const rangeInput = document.querySelector('input[name="startTime"][max], input[name="endTime"][max]');
    if (rangeInput) {
      const maxVal = parseFloat(rangeInput.getAttribute('max'));
      if (!isNaN(maxVal) && maxVal > 0) return maxVal;
    }

    // Fallback 3: Parse total duration text format "04:51:936"
    const pElements = Array.from(document.querySelectorAll('p.MuiTypography-root'));
    for (let p of pElements) {
      const match = p.textContent.trim().match(/^(\d+):(\d+):(\d+)$/);
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const ms = parseInt(match[3], 10);
        return mins * 60 + secs + (ms / 1000);
      }
    }

    return 0;
  }

  // --- Synthetic Event Trigger Helper ---
  function triggerClick(element) {
    if (!element) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));
    if (typeof element.click === 'function') {
      element.click();
    }
  }

  // --- Sidebar Page List Scanner ---
  function getSidebarPageList() {
    // 1. If sidebar drawer is closed, open it if possible
    const openSidebarBtn = document.querySelector('button[aria-label*="Open sidebar" i], button.jss253');
    if (openSidebarBtn && !document.querySelector('a[href*="/pages/"]')) {
      triggerClick(openSidebarBtn);
    }

    const allLinks = Array.from(document.querySelectorAll('a[href*="/pages/"]'));
    const pages = [];
    const seenIds = new Set();

    allLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      // Filter out links that are not section page cards (e.g. settings, resources, tts, audio)
      if (href.includes('/settings') || href.includes('/resources') || href.includes('/tts') || href.includes('/audio')) return;

      const match = href.match(/\/pages\/([a-f0-9-]+)(?:\/editor)?$/i);
      if (!match) return;

      const pageId = match[1];
      if (seenIds.has(pageId)) return;

      const text = link.textContent.trim();
      const numMatch = text.match(/\b(\d+)\b/);

      // Exclude text navigation buttons (e.g. "Preview", "Back to Contents")
      const lettersOnly = text.replace(/[\d\s]/g, '');
      if (lettersOnly.length > 0 && !link.querySelector('img')) {
        return;
      }

      if (!numMatch) return;
      const pageNum = parseInt(numMatch[1], 10);

      const isCurrent = link.getAttribute('aria-current') === 'page' ||
                        link.classList.contains('active') ||
                        link.classList.contains('jss687') ||
                        window.location.pathname.includes(pageId) ||
                        !!link.querySelector('[aria-current="page"]');

      seenIds.add(pageId);
      pages.push({
        element: link,
        pageId: pageId,
        href: href,
        pageNum: pageNum,
        isCurrent: isCurrent
      });
    });

    pages.sort((a, b) => a.pageNum - b.pageNum);
    return pages;
  }

  // --- Next Page Navigation Helper ---
  function navigateToNextPage() {
    // 1. Prioritize reliable sidebar thumbnail list
    const sidebarPages = getSidebarPageList();
    if (sidebarPages.length > 0) {
      const currentIdx = sidebarPages.findIndex(p => p.isCurrent);
      if (currentIdx !== -1 && currentIdx < sidebarPages.length - 1) {
        const nextTarget = sidebarPages[currentIdx + 1];
        triggerClick(nextTarget.element);
        blurActiveElement();
        showToast('▶️', `Navigating to Page ${nextTarget.pageNum}`);
        return;
      } else if (currentIdx === sidebarPages.length - 1) {
        showToast('ℹ️', 'Already on the last page of this chapter');
        return;
      }
    }

    // 2. Fallback to chevron buttons if sidebar is not yet indexed
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    let nextBtn = null;

    for (let svg of allSvgs) {
      const path = svg.querySelector('path');
      if (!path) continue;
      const d = path.getAttribute('d') || '';

      if (d.includes('M10 6L8.59') || d.includes('13.17 12') || d.includes('6-6z')) {
        nextBtn = svg.closest('button') || svg.closest('a') || svg.parentElement || svg;
        break;
      }
    }

    if (!nextBtn) {
      nextBtn = document.querySelector('button[aria-label*="next" i], button[title*="next" i], .MuiPaginationItem-next');
    }

    if (nextBtn) {
      triggerClick(nextBtn);
      blurActiveElement();
      showToast('▶️', 'Navigating to Next Page');
    } else {
      showToast('⚠️', 'Next Page button not found');
    }
  }

  // --- Previous Page Navigation Helper ---
  function navigateToPreviousPage() {
    // 1. Prioritize reliable sidebar thumbnail list
    const sidebarPages = getSidebarPageList();
    if (sidebarPages.length > 0) {
      const currentIdx = sidebarPages.findIndex(p => p.isCurrent);
      if (currentIdx > 0) {
        const prevTarget = sidebarPages[currentIdx - 1];
        triggerClick(prevTarget.element);
        blurActiveElement();
        showToast('◀️', `Navigating to Page ${prevTarget.pageNum}`);
        return;
      } else if (currentIdx === 0) {
        showToast('ℹ️', 'Already on the first page of this chapter');
        return;
      }
    }

    // 2. Fallback to chevron buttons if sidebar is not yet indexed
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    let prevBtn = null;

    for (let svg of allSvgs) {
      const path = svg.querySelector('path');
      if (!path) continue;
      const d = path.getAttribute('d') || '';

      if (d.includes('M15.41 7.41') || d.includes('10.83 12') || d.includes('14 6l-6 6')) {
        prevBtn = svg.closest('button') || svg.closest('a') || svg.parentElement || svg;
        break;
      }
    }

    if (!prevBtn) {
      prevBtn = document.querySelector('button[aria-label*="previous" i], button[aria-label*="prev" i], button[title*="prev" i], .MuiPaginationItem-previous');
    }

    if (prevBtn) {
      triggerClick(prevBtn);
      blurActiveElement();
      showToast('◀️', 'Navigating to Previous Page');
    } else {
      showToast('⚠️', 'Previous Page button not found');
    }
  }

  // --- Main Play/Pause Control ---
  function toggleMainAudio(mainAudio) {
    const allSvgs = Array.from(document.querySelectorAll('svg'));
    let playBtn = null;
    let pauseBtn = null;

    for (let svg of allSvgs) {
      let parent = svg.parentElement;
      let isAnnotation = false;
      while (parent && parent !== document.body) {
        if (parent.querySelector('input[name="startTime"]')) {
          isAnnotation = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (isAnnotation) continue;

      const path = svg.querySelector('path');
      if (!path) continue;
      const d = path.getAttribute('d') || '';

      if (d.includes('M8 6.82') || d.includes('8 6.82')) {
        playBtn = svg.closest('button') || svg.closest('div') || svg;
      } else if (d.includes('M8 19') || d.includes('8 19')) {
        pauseBtn = svg.closest('button') || svg.closest('div') || svg;
      }
    }

    if (mainAudio.paused) {
      if (playBtn) triggerClick(playBtn);
      mainAudio.play().catch(() => {});
      showToast('▶️', 'Audio Playing', formatTimeDisplay(mainAudio.currentTime));
    } else {
      if (pauseBtn) triggerClick(pauseBtn);
      mainAudio.pause();
      showToast('⏸️', 'Audio Paused', formatTimeDisplay(mainAudio.currentTime));
    }
  }

  // --- Annotation Cards Locator ---
  function getAnnotationCards() {
    const startTimeInputs = Array.from(document.querySelectorAll('input[name="startTime"]'));
    if (startTimeInputs.length === 0) {
      const pElements = Array.from(document.querySelectorAll('p.MuiTypography-root'));
      const cardContainers = [];
      pElements.forEach(p => {
        const text = p.textContent.trim();
        if (/^\d+$/.test(text)) {
          let card = p.parentElement;
          while (card && card !== document.body) {
            if (card.querySelector('input[name="endTime"]') || card.classList.contains('jss668')) {
              cardContainers.push(card);
              break;
            }
            card = card.parentElement;
          }
        }
      });
      return cardContainers;
    }

    const cards = startTimeInputs.map(input => {
      let card = input.parentElement;
      while (card && card !== document.body) {
        if (card.querySelector('input[name="endTime"]') && (card.querySelector('p') || card.querySelector('button'))) {
          return card;
        }
        card = card.parentElement;
      }
      return input.closest('.jss668') || input.parentElement.parentElement.parentElement;
    });

    return cards.filter(Boolean);
  }

  // --- Extract Start Time and End Time Inputs from a Card ---
  function getCardInputs(card) {
    if (!card) return { startInput: null, endInput: null };

    let startInput = card.querySelector('input[name="startTime"]') ||
                     card.querySelector('input[name*="start" i]');
    let endInput = card.querySelector('input[name="endTime"]') ||
                   card.querySelector('input[name*="end" i]');

    // Fallback by input order
    if (!startInput || !endInput) {
      const numInputs = Array.from(card.querySelectorAll('input[type="number"], input:not([type="hidden"]):not([type="checkbox"])'));
      if (numInputs.length >= 2) {
        if (!startInput) startInput = numInputs[0];
        if (!endInput) endInput = numInputs[1];
      }
    }

    return { startInput, endInput };
  }

  // --- Card Selection & Highlight ---
  function updateSelectionHighlight() {
    const cards = getAnnotationCards();
    
    document.querySelectorAll('.mst-annotation-card-selected').forEach(el => {
      el.classList.remove('mst-annotation-card-selected');
    });
    document.querySelectorAll('.mst-selected-badge').forEach(el => {
      el.remove();
    });

    if (!settings.enabled || cards.length === 0) return;

    if (selectedIndex < 1) selectedIndex = 1;
    if (selectedIndex > cards.length) selectedIndex = cards.length;

    const selectedCard = cards[selectedIndex - 1];
    if (selectedCard) {
      selectedCard.classList.add('mst-annotation-card-selected');
      
      const badge = document.createElement('div');
      badge.className = 'mst-selected-badge';
      badge.textContent = `SELECTED #${selectedIndex}`;
      selectedCard.appendChild(badge);
    }
  }

  function selectAnnotationCard(index, scroll = true) {
    const cards = getAnnotationCards();
    if (cards.length === 0) {
      showToast('⚠️', 'No audio annotations found on page');
      return;
    }

    if (index < 1 || index > cards.length) {
      showToast('⚠️', `Annotation #${index} not found (Total: ${cards.length})`);
      return;
    }

    selectedIndex = index;
    updateSelectionHighlight();
    blurActiveElement();

    const targetCard = cards[selectedIndex - 1];
    if (targetCard) {
      if (scroll) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      showToast('🔢', `Selected Annotation`, `#${selectedIndex}`);
    }
  }

  // --- Save or Update Selected Annotation ---
  function saveOrUpdateAnnotation(card, cardIndex) {
    if (!card) return;

    const buttons = Array.from(card.querySelectorAll('button'));
    let targetBtn = buttons.find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text.includes('save') || text.includes('update') || text.includes('add');
    });

    if (!targetBtn) {
      targetBtn = buttons.find(b => {
        const text = b.textContent.trim().toLowerCase();
        return !text.includes('remove') && !text.includes('delete') && !text.includes('cancel');
      });
    }

    if (targetBtn) {
      targetBtn.disabled = false;
      triggerClick(targetBtn);
      blurActiveElement();
      const text = targetBtn.textContent.trim();
      const actionLabel = text.toLowerCase().includes('save') ? 'Saved' : 'Updated';
      showToast('💾', `${actionLabel} Annotation`, `#${cardIndex}`);
    } else {
      showToast('⚠️', `Save/Update button not found for #${cardIndex}`);
    }
  }

  // --- Dispatch React Native Input Event (Bypasses React 16/17/18 ValueTracker) ---
  function setNativeInputValue(input, val) {
    if (!input) return;
    const stringVal = String(val);

    // Reset React's internal value tracker if attached to input element
    if (input._valueTracker) {
      input._valueTracker.setValue('');
    }

    // Call native HTMLInputElement prototype setter
    const prototype = Object.getPrototypeOf(input);
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(input, stringVal);
    } else {
      input.value = stringVal;
    }

    // Dispatch synthetic React input, change, and blur events
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: stringVal }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
  }

  // --- Format Seconds to mm:ss.ms ---
  function formatTimeDisplay(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00.000';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    const mmStr = String(mins).padStart(2, '0');
    const ssStr = String(secs).padStart(2, '0');
    const msStr = String(ms).padStart(3, '0');
    return `${mmStr}:${ssStr}.${msStr}`;
  }

  // =========================================================================
  // --- ANNOTATION TIMING MANAGER & MOVEABLE WINDOW MODULE ---
  // =========================================================================

  // Scan live annotation cards from the DOM
  function scanPageAnnotations() {
    const cards = getAnnotationCards();
    const list = [];

    cards.forEach((card, idx) => {
      const num = idx + 1;
      const { startInput, endInput } = getCardInputs(card);

      const startTime = startInput ? parseFloat(startInput.value) || 0 : 0;
      const endTime = endInput ? parseFloat(endInput.value) || 0 : 0;
      const duration = Math.max(0, endTime - startTime);

      list.push({
        originalIndex: num,
        startTime: startTime,
        endTime: endTime,
        duration: duration
      });
    });

    scannedTimings = JSON.parse(JSON.stringify(list));
    reorderedTimings = JSON.parse(JSON.stringify(list));
    return list;
  }

  // Floating Launcher Button on page
  function createFloatingLauncherButton() {
    if (document.getElementById('mst-floating-launcher')) return;

    const btn = document.createElement('button');
    btn.id = 'mst-floating-launcher';
    btn.className = 'mst-floating-btn';
    btn.innerHTML = `<span>⏱️</span><span>Manage Timings</span>`;
    btn.title = 'Open Moveable Timing Manager (Alt+M)';
    btn.addEventListener('click', () => {
      openTimingManagerModal();
    });

    document.body.appendChild(btn);
    updateFloatingButtonVisibility();
  }

  function updateFloatingButtonVisibility() {
    const btn = document.getElementById('mst-floating-launcher');
    if (btn) {
      btn.style.display = (settings.enabled && settings.showFloatingButton !== false) ? 'flex' : 'none';
    }
  }

  // Open & Render Moveable Timing Manager Modal Dialog (No Backdrop Blur)
  function openTimingManagerModal() {
    scanPageAnnotations();

    if (scannedTimings.length === 0) {
      showToast('⚠️', 'No audio annotations found on this page to manage');
      return;
    }

    if (!timingModalContainer) {
      timingModalContainer = document.createElement('div');
      timingModalContainer.id = 'mst-timing-modal-root';
      document.body.appendChild(timingModalContainer);
    }

    renderModalContent();
    timingModalContainer.style.display = 'block';
  }

  function closeTimingManagerModal() {
    if (timingModalContainer) {
      timingModalContainer.style.display = 'none';
    }
  }

  // Make the window smoothly draggable by its header
  function makeElementDraggable(windowCard, dragHeader) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    dragHeader.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = windowCard.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      windowCard.style.right = 'auto';
      windowCard.style.left = `${initialLeft}px`;
      windowCard.style.top = `${initialTop}px`;
      windowCard.classList.add('mst-window-dragging');

      function onMouseMove(moveEvent) {
        if (!isDragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        const maxLeft = window.innerWidth - windowCard.offsetWidth - 10;
        const maxTop = window.innerHeight - windowCard.offsetHeight - 10;

        windowCard.style.left = `${Math.max(10, Math.min(maxLeft, initialLeft + dx))}px`;
        windowCard.style.top = `${Math.max(10, Math.min(maxTop, initialTop + dy))}px`;
      }

      function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        windowCard.classList.remove('mst-window-dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // Render modal dialog UI
  function renderModalContent() {
    if (!timingModalContainer) return;

    timingModalContainer.innerHTML = `
      <div class="mst-modal-card" id="mstDraggableCard">
        
        <!-- Header (Draggable Handle) -->
        <div class="mst-modal-header" id="mstModalHeader" title="Click and drag to move window">
          <div class="mst-modal-title-group">
            <span class="mst-modal-icon">⏱️</span>
            <div>
              <h3 class="mst-modal-title">Annotation Timing Manager</h3>
              <p class="mst-modal-subtitle">Drag header to move window anywhere on screen</p>
            </div>
          </div>
          <button class="mst-modal-close-btn" id="mstModalCloseBtn" title="Close (Esc)">&times;</button>
        </div>

        <!-- Toolbar -->
        <div class="mst-modal-toolbar">
          <div class="mst-toolbar-left">
            <button class="mst-tool-btn" id="mstBtnScan" title="Re-scan annotations currently on the page">
              <span>🔄</span> Scan Page
            </button>
            <button class="mst-tool-btn" id="mstBtnReset" title="Reset order to original scanned page order">
              <span>↩️</span> Reset Order
            </button>
          </div>
          <div class="mst-toolbar-right">
            <button class="mst-tool-btn" id="mstBtnExport" title="Export timings as readable text / backup file">
              <span>💾</span> Export Timings (.txt)
            </button>
            <button class="mst-tool-btn" id="mstBtnImport" title="Import timings from a previously saved file">
              <span>📂</span> Load Timings (.txt)
            </button>
            <input type="file" id="mstFileInput" accept=".txt,.json" style="display: none;">
          </div>
        </div>

        <!-- Table Container -->
        <div class="mst-table-container">
          <table class="mst-timing-table">
            <thead>
              <tr>
                <th style="width: 90px;">Slot</th>
                <th style="width: 80px; text-align: center;">Reorder</th>
                <th>Source Timing</th>
                <th style="width: 120px;">Start Time (s)</th>
                <th style="width: 120px;">End Time (s)</th>
                <th style="width: 90px;">Duration</th>
                <th style="width: 110px;">Status</th>
              </tr>
            </thead>
            <tbody id="mstTimingTableBody">
              <!-- Rows injected dynamically -->
            </tbody>
          </table>
        </div>

        <!-- Footer Actions -->
        <div class="mst-modal-footer">
          <div class="mst-footer-info" id="mstFooterStatus">
            ${scannedTimings.length} annotations loaded. Drag rows or use ▲/▼ to arrange timings.
          </div>
          <div class="mst-footer-buttons">
            <button class="mst-btn mst-btn-secondary" id="mstBtnCancel">Cancel</button>
            <button class="mst-btn mst-btn-primary" id="mstBtnApply">
              <span>🚀</span> Apply Changes to Page
            </button>
          </div>
        </div>

      </div>
    `;

    const card = document.getElementById('mstDraggableCard');
    const header = document.getElementById('mstModalHeader');
    if (card && header) {
      makeElementDraggable(card, header);
    }

    renderTableRows();
    attachModalEvents();
  }

  // Render individual rows in the table
  function renderTableRows() {
    const tbody = document.getElementById('mstTimingTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    reorderedTimings.forEach((item, slotIndex) => {
      const targetSlotNumber = slotIndex + 1;
      const isMoved = item.originalIndex !== targetSlotNumber;
      
      const tr = document.createElement('tr');
      tr.className = `mst-timing-row ${isMoved ? 'mst-row-moved' : ''}`;
      tr.dataset.index = slotIndex;
      tr.draggable = true;

      tr.innerHTML = `
        <td class="mst-cell-slot">
          <span class="mst-slot-badge">Slot #${targetSlotNumber}</span>
        </td>
        <td class="mst-cell-movers">
          <div class="mst-mover-controls">
            <button class="mst-move-btn btn-up" data-index="${slotIndex}" ${slotIndex === 0 ? 'disabled' : ''} title="Move Up">▲</button>
            <span class="mst-drag-handle" title="Drag to reorder">⋮⋮</span>
            <button class="mst-move-btn btn-down" data-index="${slotIndex}" ${slotIndex === reorderedTimings.length - 1 ? 'disabled' : ''} title="Move Down">▼</button>
          </div>
        </td>
        <td class="mst-cell-source">
          <span class="mst-source-tag ${isMoved ? 'tag-moved' : 'tag-original'}">
            Timing from #${item.originalIndex}
          </span>
        </td>
        <td class="mst-cell-time">
          <input type="number" step="0.001" min="0" class="mst-time-input input-start" data-index="${slotIndex}" value="${item.startTime}">
          <span class="mst-time-subtext">${formatTimeDisplay(item.startTime)}</span>
        </td>
        <td class="mst-cell-time">
          <input type="number" step="0.001" min="0" class="mst-time-input input-end" data-index="${slotIndex}" value="${item.endTime}">
          <span class="mst-time-subtext">${formatTimeDisplay(item.endTime)}</span>
        </td>
        <td class="mst-cell-duration">
          <span class="mst-duration-badge">${(Math.max(0, item.endTime - item.startTime)).toFixed(2)}s</span>
        </td>
        <td class="mst-cell-status">
          ${isMoved 
            ? `<span class="mst-status-pill pill-moved">Moved #${item.originalIndex} → #${targetSlotNumber}</span>`
            : `<span class="mst-status-pill pill-original">Unchanged</span>`
          }
        </td>
      `;

      tbody.appendChild(tr);
    });

    attachRowEvents();
  }

  // Row move operation: Splice and Shift
  function moveTimingItem(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= reorderedTimings.length || toIndex >= reorderedTimings.length) {
      return;
    }

    const [movedItem] = reorderedTimings.splice(fromIndex, 1);
    reorderedTimings.splice(toIndex, 0, movedItem);

    renderTableRows();
  }

  // Attach drag & drop + Up/Down button events
  function attachRowEvents() {
    const tbody = document.getElementById('mstTimingTableBody');
    if (!tbody) return;

    // Up / Down Button Handlers
    tbody.querySelectorAll('.btn-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (idx > 0) moveTimingItem(idx, idx - 1);
      });
    });

    tbody.querySelectorAll('.btn-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (idx < reorderedTimings.length - 1) moveTimingItem(idx, idx + 1);
      });
    });

    // Time input direct edits
    tbody.querySelectorAll('.input-start').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        const val = parseFloat(e.currentTarget.value) || 0;
        reorderedTimings[idx].startTime = val;
        reorderedTimings[idx].duration = Math.max(0, reorderedTimings[idx].endTime - val);
        renderTableRows();
      });
    });

    tbody.querySelectorAll('.input-end').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        const val = parseFloat(e.currentTarget.value) || 0;
        reorderedTimings[idx].endTime = val;
        reorderedTimings[idx].duration = Math.max(0, val - reorderedTimings[idx].startTime);
        renderTableRows();
      });
    });

    // HTML5 Drag & Drop
    let draggedIndex = null;

    tbody.querySelectorAll('.mst-timing-row').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        draggedIndex = parseInt(row.dataset.index, 10);
        row.classList.add('mst-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedIndex);
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('mst-dragging');
        tbody.querySelectorAll('.mst-timing-row').forEach(r => r.classList.remove('mst-drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('mst-drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('mst-drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('mst-drag-over');
        const targetIndex = parseInt(row.dataset.index, 10);
        if (draggedIndex !== null && draggedIndex !== targetIndex) {
          moveTimingItem(draggedIndex, targetIndex);
        }
      });
    });
  }

  // Attach modal toolbar & footer events
  function attachModalEvents() {
    const closeBtn = document.getElementById('mstModalCloseBtn');
    const cancelBtn = document.getElementById('mstBtnCancel');
    const scanBtn = document.getElementById('mstBtnScan');
    const resetBtn = document.getElementById('mstBtnReset');
    const exportBtn = document.getElementById('mstBtnExport');
    const importBtn = document.getElementById('mstBtnImport');
    const fileInput = document.getElementById('mstFileInput');
    const applyBtn = document.getElementById('mstBtnApply');

    if (closeBtn) closeBtn.addEventListener('click', closeTimingManagerModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeTimingManagerModal);

    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        scanPageAnnotations();
        renderTableRows();
        showToast('🔄', `Scanned ${scannedTimings.length} annotations from page`);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        reorderedTimings = JSON.parse(JSON.stringify(scannedTimings));
        renderTableRows();
        showToast('↩️', 'Reset table to original page order');
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', exportTimingsToFile);
    }

    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          importTimingsFromFile(evt.target.result);
          fileInput.value = '';
        };
        reader.readAsText(file);
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', applyTimingsToPage);
    }
  }

  // --- Export Timings to Text File ---
  function exportTimingsToFile() {
    if (reorderedTimings.length === 0) {
      showToast('⚠️', 'No timings to export');
      return;
    }

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const pageUrl = window.location.href;

    let content = `=================================================================\n`;
    content += `mySecondTeacher Annotation Timings Export\n`;
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Page URL: ${pageUrl}\n`;
    content += `Total Annotations: ${reorderedTimings.length}\n`;
    content += `=================================================================\n\n`;
    content += `SLOT | SOURCE TIMING | START TIME        | END TIME          | DURATION\n`;
    content += `-----------------------------------------------------------------\n`;

    reorderedTimings.forEach((item, idx) => {
      const slot = `Slot #${idx + 1}`.padEnd(6);
      const src = `From #${item.originalIndex}`.padEnd(14);
      const start = `${formatTimeDisplay(item.startTime)} (${item.startTime}s)`.padEnd(18);
      const end = `${formatTimeDisplay(item.endTime)} (${item.endTime}s)`.padEnd(18);
      const dur = `${(Math.max(0, item.endTime - item.startTime)).toFixed(2)}s`;
      content += `${slot} | ${src} | ${start} | ${end} | ${dur}\n`;
    });

    content += `\n\n=================================================================\n`;
    content += `[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]\n`;
    content += `=================================================================\n`;
    content += JSON.stringify({
      version: "1.6.0",
      pageUrl: pageUrl,
      timings: reorderedTimings
    }, null, 2);

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotation_timings_${dateStr}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('💾', 'Exported timings text file successfully');
  }

  // --- Import Timings from File ---
  function importTimingsFromFile(text) {
    try {
      let importedList = null;

      if (text.includes('[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]')) {
        const parts = text.split('[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]');
        if (parts.length > 1) {
          const jsonStr = parts[1].replace(/^[=\s]+/, '');
          const data = JSON.parse(jsonStr);
          if (data && Array.isArray(data.timings)) {
            importedList = data.timings;
          }
        }
      }

      if (!importedList) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) importedList = data;
          else if (data && Array.isArray(data.timings)) importedList = data.timings;
        } catch (e) {}
      }

      if (!importedList) {
        importedList = [];
        const lines = text.split('\n');
        lines.forEach(line => {
          const match = line.match(/Slot\s*#(\d+).*?\(([\d.]+)s\).*?\(([\d.]+)s\)/);
          if (match) {
            importedList.push({
              originalIndex: parseInt(match[1], 10),
              startTime: parseFloat(match[2]),
              endTime: parseFloat(match[3]),
              duration: Math.max(0, parseFloat(match[3]) - parseFloat(match[2]))
            });
          }
        });
      }

      if (!importedList || importedList.length === 0) {
        alert('Could not parse timing data from the selected file. Please make sure it is a valid exported timing text file.');
        return;
      }

      reorderedTimings = importedList.map((item, i) => ({
        originalIndex: item.originalIndex || (i + 1),
        startTime: typeof item.startTime === 'number' ? item.startTime : parseFloat(item.startTime) || 0,
        endTime: typeof item.endTime === 'number' ? item.endTime : parseFloat(item.endTime) || 0,
        duration: Math.max(0, (item.endTime || 0) - (item.startTime || 0))
      }));

      renderTableRows();
      showToast('📂', `Loaded ${reorderedTimings.length} timings from file`);
    } catch (err) {
      alert(`Error reading timing file: ${err.message}`);
    }
  }

  // --- Apply Changes to Page with Safe Sequential Auto-Save ---
  async function applyTimingsToPage() {
    const cards = getAnnotationCards();
    if (cards.length === 0) {
      alert('No annotation cards found on the page to update.');
      return;
    }

    const applyBtn = document.getElementById('mstBtnApply');
    const footerStatus = document.getElementById('mstFooterStatus');
    if (applyBtn) applyBtn.disabled = true;

    showToast('🚀', 'Applying reordered timings to page...');

    const totalToApply = Math.min(cards.length, reorderedTimings.length);

    for (let i = 0; i < totalToApply; i++) {
      const targetSlotNum = i + 1;
      const timing = reorderedTimings[i];
      const card = cards[i];

      if (footerStatus) {
        footerStatus.innerHTML = `⏳ Updating Slot #${targetSlotNum} / ${totalToApply} (Start: ${timing.startTime}s, End: ${timing.endTime}s)...`;
      }

      const { startInput, endInput } = getCardInputs(card);

      if (startInput) {
        setNativeInputValue(startInput, timing.startTime);
      }
      if (endInput) {
        setNativeInputValue(endInput, timing.endTime);
      }

      await new Promise(resolve => setTimeout(resolve, 150));

      const buttons = Array.from(card.querySelectorAll('button'));
      let saveOrUpdateBtn = buttons.find(b => {
        const text = b.textContent.trim().toLowerCase();
        return text.includes('save') || text.includes('update') || text.includes('add');
      });

      if (!saveOrUpdateBtn) {
        saveOrUpdateBtn = buttons.find(b => {
          const text = b.textContent.trim().toLowerCase();
          return !text.includes('remove') && !text.includes('delete') && !text.includes('cancel');
        });
      }

      if (saveOrUpdateBtn) {
        saveOrUpdateBtn.disabled = false;
        triggerClick(saveOrUpdateBtn);
      }

      await new Promise(resolve => setTimeout(resolve, 150));
    }

    if (footerStatus) {
      footerStatus.innerHTML = `✅ Successfully applied and saved timings for all ${totalToApply} annotations!`;
    }
    if (applyBtn) applyBtn.disabled = false;

    scanPageAnnotations();
    renderTableRows();

    showToast('✅', `Applied and saved ${totalToApply} annotation timings!`);

    setTimeout(() => {
      closeTimingManagerModal();
    }, 1200);
  }

  // --- Main Keyboard Event Listener ---
  function handleKeyDown(e) {
    if (!settings.enabled) return;

    // Alt + M: Open Timing Manager
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      openTimingManagerModal();
      return;
    }

    // Escape: Close Modal if open
    if (e.key === 'Escape' && timingModalContainer && timingModalContainer.style.display !== 'none') {
      closeTimingManagerModal();
      return;
    }

    // 1: Spacebar to Toggle Pause/Play Main Audio (WORKS REGARDLESS OF FOCUSED ELEMENT!)
    if (e.code === 'Space' || e.key === ' ') {
      if (!settings.shortcutSpace) return;
      e.preventDefault();
      e.stopPropagation();

      blurActiveElement();

      const mainAudio = getMainAudioElement();
      if (!mainAudio) {
        showToast('⚠️', 'Main audio element not found');
        return;
      }

      toggleMainAudio(mainAudio);
      return;
    }

    // 2: Shift + Enter: Save or Update Selected Annotation (WORKS REGARDLESS OF FOCUS!)
    if (e.key === 'Enter' && e.shiftKey) {
      if (!settings.shortcutSave) return;
      e.preventDefault();
      e.stopPropagation();

      const cards = getAnnotationCards();
      if (cards.length === 0) {
        showToast('⚠️', 'No annotation card to save/update');
        return;
      }

      if (selectedIndex < 1 || selectedIndex > cards.length) {
        selectedIndex = 1;
      }

      const selectedCard = cards[selectedIndex - 1];
      saveOrUpdateAnnotation(selectedCard, selectedIndex);
      return;
    }

    // 3: Next Page (>) and Previous Page (<) Shortcuts
    if (e.key === '>' || e.key === '<' || ((e.key === '.' || e.key === ',') && !isInputActive(e))) {
      if (settings.shortcutPageNav !== false) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === '>' || e.key === '.') {
          navigateToNextPage();
        } else if (e.key === '<' || e.key === ',') {
          navigateToPreviousPage();
        }
        return;
      }
    }

    // Bypass remaining shortcuts ONLY if user is actively typing in a non-annotation text field (e.g. Chapter Title)
    if (isInputActive(e)) return;

    const mainAudio = getMainAudioElement();

    // 4: Number keys 1 to 9 to select audio annotations (NO INPUT FOCUS!)
    if (!e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      if (!settings.shortcutNumbers) return;
      e.preventDefault();
      e.stopPropagation();

      const cardIndex = parseInt(e.key, 10);
      selectAnnotationCard(cardIndex);
      return;
    }

    // 5: Square Bracket [ (Set Start Time to Current Audio Time)
    if (e.key === '[' || e.code === 'BracketLeft') {
      if (!settings.shortcutBrackets) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) {
        showToast('⚠️', 'Main audio not loaded');
        return;
      }

      const cards = getAnnotationCards();
      if (cards.length === 0) {
        showToast('⚠️', 'No annotations to set time');
        return;
      }

      if (selectedIndex < 1 || selectedIndex > cards.length) {
        selectedIndex = 1;
      }

      const selectedCard = cards[selectedIndex - 1];
      const { startInput } = getCardInputs(selectedCard);
      if (!startInput) {
        showToast('⚠️', `Start Time input missing for #${selectedIndex}`);
        return;
      }

      const curTime = mainAudio.currentTime;
      const formattedValue = Number(curTime.toFixed(settings.precision || 3));
      setNativeInputValue(startInput, formattedValue);
      blurActiveElement();
      showToast('⏱️', `Annotation #${selectedIndex} Start Time:`, formatTimeDisplay(curTime));
      return;
    }

    // 6: Square Bracket ] (Set End Time + Optional Deadline Mode Fast Flow)
    if (e.key === ']' || e.code === 'BracketRight') {
      if (!settings.shortcutBrackets) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) {
        showToast('⚠️', 'Main audio not loaded');
        return;
      }

      const cards = getAnnotationCards();
      if (cards.length === 0) {
        showToast('⚠️', 'No annotations to set time');
        return;
      }

      if (selectedIndex < 1 || selectedIndex > cards.length) {
        selectedIndex = 1;
      }

      const selectedCard = cards[selectedIndex - 1];
      const { endInput } = getCardInputs(selectedCard);
      if (!endInput) {
        showToast('⚠️', `End Time input missing for #${selectedIndex}`);
        return;
      }

      const curTime = mainAudio.currentTime;
      const formattedValue = Number(curTime.toFixed(settings.precision || 3));
      setNativeInputValue(endInput, formattedValue);
      blurActiveElement();

      // --- DEADLINE MODE RAPID ANNOTATION FLOW ---
      if (settings.deadlineMode) {
        saveOrUpdateAnnotation(selectedCard, selectedIndex);

        const nextIndex = selectedIndex + 1;
        if (nextIndex <= cards.length) {
          const delay = Math.max(0, parseFloat(settings.deadlineDelay) || 0.0);
          const nextStartTime = Number((curTime + delay).toFixed(settings.precision || 3));

          selectAnnotationCard(nextIndex);

          const nextCard = cards[nextIndex - 1];
          if (nextCard) {
            const { startInput: nextStartInput } = getCardInputs(nextCard);
            if (nextStartInput) {
              setNativeInputValue(nextStartInput, nextStartTime);
            }
          }

          showToast('⚡', `[Deadline] #${selectedIndex - 1} Saved ➔ #${selectedIndex} Start:`, formatTimeDisplay(nextStartTime));
        } else {
          showToast('🏁', `[Deadline] Final Annotation #${selectedIndex} Saved!`);
        }
      } else {
        showToast('⏱️', `Annotation #${selectedIndex} End Time:`, formatTimeDisplay(curTime));
      }
      return;
    }

    // 7: Backtick Key ` or Tilde ~ (Set End Time of Selected Annotation to Audio Duration MINUS 0.01s Safety Buffer)
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
      if (!settings.shortcutAudioEnd) return;
      e.preventDefault();
      e.stopPropagation();

      blurActiveElement();

      const totalDuration = getMainAudioDuration(mainAudio);
      if (totalDuration <= 0) {
        showToast('⚠️', 'Audio total duration not available');
        return;
      }

      const cards = getAnnotationCards();
      if (cards.length === 0) {
        showToast('⚠️', 'No annotations to set time');
        return;
      }

      if (selectedIndex < 1 || selectedIndex > cards.length) {
        selectedIndex = 1;
      }

      const selectedCard = cards[selectedIndex - 1];
      const { endInput } = getCardInputs(selectedCard);
      if (!endInput) {
        showToast('⚠️', `End Time input missing for #${selectedIndex}`);
        return;
      }

      // Subtract safe 0.01s buffer so value never exceeds max bounds or triggers HTML5 number range failure
      let safeEndTime = Math.max(0, totalDuration - 0.01);

      // Also check max attribute on input if present
      if (endInput.hasAttribute('max')) {
        const maxAttr = parseFloat(endInput.getAttribute('max'));
        if (!isNaN(maxAttr) && maxAttr > 0) {
          safeEndTime = Math.min(safeEndTime, maxAttr - 0.01);
        }
      }

      const formattedDuration = Number(safeEndTime.toFixed(settings.precision || 3));
      setNativeInputValue(endInput, formattedDuration);
      blurActiveElement();

      // If Deadline Mode is active, auto-save as well
      if (settings.deadlineMode) {
        saveOrUpdateAnnotation(selectedCard, selectedIndex);
      }

      showToast('🏁', `Annotation #${selectedIndex} End Time (Safe Max):`, formatTimeDisplay(formattedDuration));
      return;
    }

    // 8: Side Arrow Keys (Left / Right) to seek 5 seconds
    if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft') {
      if (!settings.shortcutSeek) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) return;
      const newTime = Math.max(0, mainAudio.currentTime - (settings.seekStep || 5));
      mainAudio.currentTime = newTime;
      showToast('⏪', `Seek -${settings.seekStep || 5}s`, formatTimeDisplay(newTime));
      return;
    }

    if (e.key === 'ArrowRight' || e.code === 'ArrowRight') {
      if (!settings.shortcutSeek) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) return;
      const maxTime = getMainAudioDuration(mainAudio) || Infinity;
      const newTime = Math.min(maxTime, mainAudio.currentTime + (settings.seekStep || 5));
      mainAudio.currentTime = newTime;
      showToast('⏩', `Seek +${settings.seekStep || 5}s`, formatTimeDisplay(newTime));
      return;
    }

    // 9: Up and Down Arrow Keys to speed up or slow down playback rate
    if (e.key === 'ArrowUp' || e.code === 'ArrowUp') {
      if (!settings.shortcutSpeed) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) return;
      const currentRate = mainAudio.playbackRate || 1.0;
      const newRate = Math.min(4.0, +(currentRate + (settings.speedStep || 0.5)).toFixed(2));
      mainAudio.playbackRate = newRate;
      showToast('⚡', `Playback Speed:`, `${newRate}x`);
      return;
    }

    if (e.key === 'ArrowDown' || e.code === 'ArrowDown') {
      if (!settings.shortcutSpeed) return;
      e.preventDefault();
      e.stopPropagation();

      if (!mainAudio) return;
      const currentRate = mainAudio.playbackRate || 1.0;
      const newRate = Math.max(0.25, +(currentRate - (settings.speedStep || 0.5)).toFixed(2));
      mainAudio.playbackRate = newRate;
      showToast('🐢', `Playback Speed:`, `${newRate}x`);
      return;
    }
  }

  // ==========================================================================
  // --- HTML Publishing Parser (Direct Machine Downloader) Feature ---
  // ==========================================================================
  let htmlParserContainer = null;
  let parserScannedInfo = null;
  let isHtmlScrapingActive = false;

  let parserNamingState = {
    prefixEnabled: false,
    prefixVal: '',
    prefixAutoIncrement: false,
    nameVal: '',
    useSitePageName: false,
    suffixEnabled: true,
    suffixVal: 'Page',
    suffixAutoIncrement: true,
    padDigits: 3
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeFilename(name) {
    return (name || 'Chapter_Page')
      .replace(/[\\/:*?"<>|]/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scanChapterInfo() {
    let chapterTitle = '';
    // 1. Try input[name="sectionTitle"]
    const titleInput = document.querySelector('input[name="sectionTitle"]');
    if (titleInput && titleInput.value && titleInput.value.trim()) {
      chapterTitle = titleInput.value.trim();
    }

    // 2. Try unit/book title elements (e.g. jss190, jss193)
    let unitTitle = '';
    const unitEl = document.querySelector('.jss190, .jss193, [class*="jss190"], [class*="jss193"]');
    if (unitEl && unitEl.textContent.trim()) {
      unitTitle = unitEl.textContent.split('|')[0].trim();
    }

    // 3. Try header paragraph containing "... - PAGE \d+" (e.g. jss352 or jss715)
    let headerPageNum = null;
    let headerParsedTitle = '';
    const candidates = Array.from(document.querySelectorAll('p, h1, h2, h3, div'));
    for (const el of candidates) {
      const text = el.textContent.trim();
      const pageMatch = text.match(/^(.*?)\s*-\s*PAGE\s*(\d+)/i);
      if (pageMatch) {
        headerParsedTitle = pageMatch[1].trim();
        if (pageMatch[2]) {
          headerPageNum = parseInt(pageMatch[2], 10);
        }
        break;
      }
    }

    if (!chapterTitle) {
      chapterTitle = headerParsedTitle || unitTitle || document.title.split('|')[0].trim() || 'Chapter';
    }

    const pages = getSidebarPageList();
    const currentIdx = pages.findIndex(p => p.isCurrent);
    const currentPageNum = headerPageNum || (currentIdx !== -1 ? pages[currentIdx].pageNum : 1);
    const totalPages = pages.length > 0 ? pages[pages.length - 1].pageNum : 1;

    return {
      chapterTitle,
      unitTitle,
      headerParsedTitle,
      pages,
      totalPages: Math.max(totalPages, pages.length),
      currentPageNum
    };
  }

  // Direct file download handler to save on machine without any external API
  async function saveHtmlFileToMachine(filename, htmlContent, subfolder = '') {
    const cleanFilename = sanitizeFilename(filename);
    const targetPath = subfolder ? `${sanitizeFilename(subfolder)}/${cleanFilename}` : cleanFilename;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    // 1. Try background service worker download (silent into subfolder)
    try {
      const res = await new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'downloadFile',
            url: blobUrl,
            filename: targetPath
          }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
        } else {
          resolve(false);
        }
      });

      if (res) {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        return true;
      }
    } catch (e) {
      // fallback below
    }

    // 2. Direct browser human-like download fallback (always works)
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentElement) a.parentElement.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 1000);
    return true;
  }

  // Focus edit_panel and extract CodeMirror HTML cleanly
  function extractCodeMirrorHtml() {
    return new Promise((resolve) => {
      // Focus edit_panel and CodeMirror wrapper
      const editPanel = document.querySelector('.edit_panel, [class*="edit_panel"]');
      if (editPanel) {
        triggerClick(editPanel);
        if (typeof editPanel.focus === 'function') editPanel.focus();
      }
      const cmEl = document.querySelector('.CodeMirror');
      if (cmEl) {
        triggerClick(cmEl);
        if (typeof cmEl.focus === 'function') cmEl.focus();
        const ta = cmEl.querySelector('textarea');
        if (ta && typeof ta.focus === 'function') ta.focus();
      }

      const eventId = 'mst_cm_read_' + Math.random().toString(36).substring(2, 9);
      function handleResult(e) {
        window.removeEventListener(eventId, handleResult);
        resolve(e.detail ? (e.detail.code || '') : '');
      }
      window.addEventListener(eventId, handleResult);

      const script = document.createElement('script');
      script.textContent = `(function() {
        try {
          const editPanel = document.querySelector('.edit_panel, [class*="edit_panel"]');
          if (editPanel && typeof editPanel.focus === 'function') {
            editPanel.focus();
          }
          const cmEl = document.querySelector('.CodeMirror');
          if (cmEl && cmEl.CodeMirror) {
            const cm = cmEl.CodeMirror;
            cm.focus();
            // Simulate Ctrl+A to select all content
            cm.execCommand('selectAll');
            // Simulate Ctrl+C / copy entire content
            const code = cm.getSelection() || cm.getValue() || '';
            // Non-destructive: collapse selection to line 0 col 0 immediately
            cm.setCursor(0, 0);
            window.dispatchEvent(new CustomEvent('${eventId}', { detail: { code: code } }));
            return;
          }
          if (cmEl) {
            const ta = cmEl.querySelector('textarea');
            if (ta && ta.value) {
              window.dispatchEvent(new CustomEvent('${eventId}', { detail: { code: ta.value } }));
              return;
            }
          }
          window.dispatchEvent(new CustomEvent('${eventId}', { detail: { code: '' } }));
        } catch(err) {
          window.dispatchEvent(new CustomEvent('${eventId}', { detail: { code: '' } }));
        }
      })();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();

      setTimeout(() => {
        window.removeEventListener(eventId, handleResult);
        if (cmEl) {
          const ta = cmEl.querySelector('textarea');
          if (ta && ta.value) return resolve(ta.value);
        }
        resolve('');
      }, 2500);
    });
  }

  function switchToHtmlTab() {
    if (document.querySelector('.CodeMirror')) return true;

    // Search 3rd navbar for <> HTML tab
    const editorTab = document.querySelector('[name="editor"]') ||
                      document.querySelector('.jss379') ||
                      document.querySelector('a[href$="/editor"]') ||
                      Array.from(document.querySelectorAll('a, button, div')).find(el => {
                        const t = el.textContent.trim();
                        return (t === 'HTML' || t.includes('HTML')) &&
                               (el.getAttribute('role') === 'button' || el.tagName === 'A' || el.classList.contains('jss741') || el.classList.contains('jss742'));
                      });

    if (editorTab) {
      triggerClick(editorTab);
      return true;
    }
    return false;
  }

  // Check if CodeMirror HTML contains genuine populated page content (not just empty skeleton)
  function isPopulatedPageHtml(code) {
    if (!code || typeof code !== 'string') return false;
    const trimmed = code.trim();
    if (trimmed.length < 150) return false;

    // Strip head and body wrappers to check for inner page content
    const stripped = trimmed
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<head>[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '')
      .replace(/<div class="loader[^>]*>[\s\S]*?<\/div>/gi, '')
      .trim();

    if (stripped.length < 30) return false;

    // Real book pages have styled divs, spans, or text
    return trimmed.includes('<div') || trimmed.includes('<style') || trimmed.includes('class=') || trimmed.includes('id=');
  }

  // Polls until CodeMirror is populated with ACTUAL page content (not just empty skeleton)
  async function waitForPopulatedCodeMirror(timeoutMs = 12000, lastPageHtml = '') {
    const start = Date.now();
    let bestCode = '';

    while (Date.now() - start < timeoutMs) {
      if (!isHtmlScrapingActive) break;

      // Ensure HTML tab is active
      switchToHtmlTab();

      // Click & focus edit_panel and CodeMirror
      const editPanel = document.querySelector('.edit_panel, [class*="edit_panel"]');
      if (editPanel) {
        triggerClick(editPanel);
        if (typeof editPanel.focus === 'function') editPanel.focus();
      }
      const cmEl = document.querySelector('.CodeMirror');
      if (cmEl) {
        triggerClick(cmEl);
        if (typeof cmEl.focus === 'function') cmEl.focus();
        const ta = cmEl.querySelector('textarea');
        if (ta && typeof ta.focus === 'function') ta.focus();
      }

      const code = await extractCodeMirrorHtml();
      if (code && code.length > bestCode.length) {
        bestCode = code;
      }

      const isPopulated = isPopulatedPageHtml(code);
      const isStale = (lastPageHtml && code === lastPageHtml && (Date.now() - start < 1500));

      if (isPopulated && !isStale) {
        // Extra pause to ensure all lines are loaded
        await new Promise(r => setTimeout(r, 350));
        const confirmed = await extractCodeMirrorHtml();
        return (confirmed && confirmed.length >= code.length) ? confirmed : code;
      }

      await new Promise(r => setTimeout(r, 350));
    }

    return bestCode;
  }

  // Dynamically extract the current lesson / page name from header breadcrumb or MuiBox
  function extractCurrentSitePageName(pageNum) {
    const candidates = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, span'));

    if (pageNum !== undefined) {
      const pageRegex = new RegExp(`^(.*?)\\s*-\\s*PAGE\\s*${pageNum}\\b`, 'i');
      for (const el of candidates) {
        const text = el.textContent.trim();
        const m = text.match(pageRegex);
        if (m && m[1]) return m[1].trim();
      }
    }

    for (const el of candidates) {
      const text = el.textContent.trim();
      const m = text.match(/^(.*?)\s*-\s*PAGE\s*\d+/i);
      if (m && m[1]) return m[1].trim();
    }

    const input = document.querySelector('input[name="sectionTitle"]');
    if (input && input.value && input.value.trim()) return input.value.trim();

    const header = document.querySelector('.jss190, .jss193, [class*="jss19"], .MuiTypography-h6');
    if (header && header.textContent) {
      const t = header.textContent.split('|')[0].trim();
      if (t) return t;
    }

    return '';
  }

  // Generate dynamic filename based on user naming configuration
  function generatePageFilename(pageNum, pageSiteTitle = '') {
    const padCount = parserNamingState.padDigits || 3;
    const numStr = padCount > 1 ? String(pageNum).padStart(padCount, '0') : String(pageNum);

    let parts = [];

    // 1. Prefix (allow '0' and custom strings, collapsible when disabled)
    if (!parserNamingState.prefixDisabled) {
      let pfx = parserNamingState.prefixVal;
      if (parserNamingState.prefixAutoIncrement) {
        pfx = (pfx !== '' && pfx !== undefined) ? `${pfx}${numStr}` : numStr;
      }
      if (pfx !== '' && pfx !== undefined) {
        parts.push(pfx);
      }
    }

    // 2. Base Name
    let baseName = '';
    if (parserNamingState.useSitePageName && pageSiteTitle) {
      baseName = sanitizeFilename(pageSiteTitle);
    } else if (parserNamingState.nameVal) {
      baseName = sanitizeFilename(parserNamingState.nameVal);
    } else if (parserScannedInfo && parserScannedInfo.chapterTitle) {
      baseName = sanitizeFilename(parserScannedInfo.chapterTitle);
    }
    if (baseName) {
      parts.push(baseName);
    }

    // 3. Suffix (collapsible when disabled, auto-increment & numbering normalizer)
    if (!parserNamingState.suffixDisabled) {
      let sfx = parserNamingState.suffixVal;
      if (parserNamingState.suffixAutoIncrement) {
        sfx = (sfx !== '' && sfx !== undefined) ? `${sfx}${numStr}` : numStr;
      }
      if (sfx !== '' && sfx !== undefined) {
        parts.push(sfx);
      }
    }

    let finalName = parts.join(' - ').trim();
    if (!finalName) {
      finalName = `Page_${numStr}`;
    }

    return `${finalName}.html`;
  }

  function openHtmlParserModal() {
    parserScannedInfo = scanChapterInfo();
    parserNamingState.nameVal = parserScannedInfo.chapterTitle || 'Chapter';

    if (!htmlParserContainer) {
      htmlParserContainer = document.createElement('div');
      htmlParserContainer.id = 'mst-html-parser-root';
      document.body.appendChild(htmlParserContainer);
    }

    renderHtmlParserModalContent();
    htmlParserContainer.style.display = 'block';
  }

  function closeHtmlParserModal() {
    if (isHtmlScrapingActive) {
      isHtmlScrapingActive = false;
    }
    parserScannedInfo = null;
    if (htmlParserContainer) {
      htmlParserContainer.style.display = 'none';
      htmlParserContainer.innerHTML = '';
    }
  }

  function updateParserNamingPreview() {
    const previewEl = document.getElementById('mstNamingPreview');
    if (!previewEl || !parserScannedInfo) return;

    const startInput = document.getElementById('mstInputStartPage');
    const startPage = parseInt(startInput?.value, 10) || 1;

    const sitePageTitle = extractCurrentSitePageName(startPage) || parserScannedInfo.headerParsedTitle;
    const p1 = generatePageFilename(startPage, sitePageTitle);
    const p2 = generatePageFilename(startPage + 1, sitePageTitle);

    previewEl.innerHTML = `Page ${startPage}: <strong>${escapeHtml(p1)}</strong><br>Page ${startPage + 1}: <strong>${escapeHtml(p2)}</strong>`;
  }

  function updateParserRunBtnState() {
    const runBtn = document.getElementById('mstBtnRunParser');
    const startInput = document.getElementById('mstInputStartPage');
    const endInput = document.getElementById('mstInputEndPage');
    if (!runBtn || !parserScannedInfo) return;

    const startVal = parseInt(startInput?.value, 10);
    const endVal = parseInt(endInput?.value, 10);
    const isValidRange = !isNaN(startVal) && !isNaN(endVal) &&
                         startVal >= 1 && endVal <= parserScannedInfo.totalPages &&
                         startVal <= endVal;

    runBtn.disabled = !isValidRange || isHtmlScrapingActive;
  }

  function renderHtmlParserModalContent() {
    if (!htmlParserContainer || !parserScannedInfo) return;

    const safeTitle = sanitizeFilename(parserScannedInfo.chapterTitle);

    htmlParserContainer.innerHTML = `
      <div class="mst-parser-card" id="mstParserWindow">
        <!-- Draggable Header -->
        <div class="mst-modal-header" id="mstParserDragHeader">
          <div class="mst-modal-title-group">
            <span class="mst-modal-icon">📑</span>
            <div>
              <h3 class="mst-modal-title">HTML Publishing Parser</h3>
              <p class="mst-modal-subtitle">Zero-edit CodeMirror HTML scraper for chapter pages</p>
            </div>
          </div>
          <button class="mst-modal-close-btn" id="mstParserCloseX" title="Close and clear">&times;</button>
        </div>

        <!-- Form Body -->
        <div class="mst-parser-body">
          <!-- Info Banner -->
          <div class="mst-parser-info">
            <strong>Chapter:</strong> <span id="mstParserChapterDisplay">${escapeHtml(parserScannedInfo.chapterTitle)}</span><br>
            <strong>Pages Detected:</strong> <span id="mstParserTotalPages">${parserScannedInfo.totalPages}</span> pages in chapter (Current: Page ${parserScannedInfo.currentPageNum})
          </div>

          <!-- Output Folder Name Row with Re-sync -->
          <div class="mst-form-row">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label class="mst-form-label" for="mstInputSubfolder" style="margin-bottom: 0;">
                Output Folder Name (in Downloads):
                <span class="mst-hint-tooltip" data-tip="Downloads into Downloads/<Folder Name>/ on your computer">?</span>
              </label>
              <button type="button" class="mst-sync-btn" id="mstBtnSyncChapter" title="Re-parse chapter name from page">🔄 Sync from Page</button>
            </div>
            <input type="text" id="mstInputSubfolder" class="mst-parser-input" value="${escapeHtml(safeTitle)}">
          </div>

          <!-- Direct Machine Download Note -->
          <div class="mst-direct-download-note">
            <span>💾</span>
            <span>Direct machine export &bull; Files download directly into your Downloads folder</span>
          </div>

          <!-- Naming Configuration Box -->
          <div class="mst-naming-section">
            <div class="mst-naming-section-title">
              <span>File Naming Controls</span>
              <span style="font-size: 11px; color: #94a3b8;">Customize Prefix, Base Name & Suffix</span>
            </div>

            <div class="mst-naming-blocks-grid">
              <!-- Prefix Column -->
              <div class="mst-naming-col">
                <div class="mst-naming-col-header">
                  <span>Prefix</span>
                  <label class="mst-checkbox-group">
                    <input type="checkbox" id="mstChkPrefixDisable" ${parserNamingState.prefixDisabled ? 'checked' : ''}>
                    <span>Disable</span>
                  </label>
                </div>
                <!-- Pill shown when disabled -->
                <div id="mstPrefixPillContainer" class="${parserNamingState.prefixDisabled ? '' : 'mst-collapsed'}">
                  <button type="button" class="mst-pill-btn" id="mstBtnOpenPrefix">[Prefix] (Disabled &bull; Click to Enable)</button>
                </div>
                <!-- Full controls when enabled -->
                <div id="mstPrefixControls" class="${parserNamingState.prefixDisabled ? 'mst-collapsed' : ''}">
                  <input type="text" id="mstInputPrefix" class="mst-parser-input" placeholder="e.g. 0 or Chap_" value="${escapeHtml(parserNamingState.prefixVal)}">
                  <label class="mst-checkbox-group" style="margin-top: 5px;">
                    <input type="checkbox" id="mstChkPrefixInc" ${parserNamingState.prefixAutoIncrement ? 'checked' : ''}>
                    <span>Auto-increment</span>
                  </label>
                </div>
              </div>

              <!-- Name Column -->
              <div class="mst-naming-col">
                <div class="mst-naming-col-header">
                  <span>Base Name</span>
                  <label class="mst-checkbox-group">
                    <input type="checkbox" id="mstChkUseSitePageName" ${parserNamingState.useSitePageName ? 'checked' : ''}>
                    <span>Use site page name</span>
                  </label>
                </div>
                <div>
                  <input type="text" id="mstInputName" class="mst-parser-input" placeholder="Title/Name" value="${escapeHtml(parserNamingState.nameVal)}">
                  <div style="font-size: 10px; color: #94a3b8; margin-top: 5px;" id="mstNameHint">
                    ${parserNamingState.useSitePageName ? '✨ Parsed from page header' : 'Custom entered name'}
                  </div>
                </div>
              </div>

              <!-- Suffix Column -->
              <div class="mst-naming-col">
                <div class="mst-naming-col-header">
                  <span>Suffix</span>
                  <label class="mst-checkbox-group">
                    <input type="checkbox" id="mstChkSuffixDisable" ${parserNamingState.suffixDisabled ? 'checked' : ''}>
                    <span>Disable</span>
                  </label>
                </div>
                <!-- Pill shown when disabled -->
                <div id="mstSuffixPillContainer" class="${parserNamingState.suffixDisabled ? '' : 'mst-collapsed'}">
                  <button type="button" class="mst-pill-btn" id="mstBtnOpenSuffix">[Suffix] (Disabled &bull; Click to Enable)</button>
                </div>
                <!-- Full controls when enabled -->
                <div id="mstSuffixControls" class="${parserNamingState.suffixDisabled ? 'mst-collapsed' : ''}">
                  <input type="text" id="mstInputSuffix" class="mst-parser-input" placeholder="e.g. Page" value="${escapeHtml(parserNamingState.suffixVal)}">
                  <label class="mst-checkbox-group" style="margin-top: 5px;">
                    <input type="checkbox" id="mstChkSuffixInc" ${parserNamingState.suffixAutoIncrement ? 'checked' : ''}>
                    <span>Auto-increment</span>
                  </label>
                  <div style="margin-top: 5px; display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 10px; color: #94a3b8;">Normalizer:</span>
                    <select id="mstSelectPadDigits" class="mst-parser-select">
                      <option value="1" ${parserNamingState.padDigits === 1 ? 'selected' : ''}>1 (No pad)</option>
                      <option value="2" ${parserNamingState.padDigits === 2 ? 'selected' : ''}>01 (2 digits)</option>
                      <option value="3" ${parserNamingState.padDigits === 3 ? 'selected' : ''}>001 (3 digits)</option>
                      <option value="4" ${parserNamingState.padDigits === 4 ? 'selected' : ''}>0001 (4 digits)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- Naming Preview Row -->
            <div class="mst-form-row" style="margin-top: 4px;">
              <label class="mst-form-label">
                Live Naming Preview:
                <span class="mst-hint-tooltip" data-tip="Preview of how files will be named when exported">?</span>
              </label>
              <div class="mst-preview-box" id="mstNamingPreview"></div>
            </div>
          </div>

          <!-- Page Range Horizontal Row -->
          <div class="mst-form-row-horizontal">
            <div class="mst-form-row">
              <label class="mst-form-label" for="mstInputStartPage">
                Start Page <span class="mst-req">*</span>
                <span class="mst-hint-tooltip" data-tip="First page number to export">?</span>
              </label>
              <input type="number" id="mstInputStartPage" class="mst-parser-input" min="1" max="${parserScannedInfo.totalPages}" value="1">
            </div>
            <div class="mst-form-row">
              <label class="mst-form-label" for="mstInputEndPage">
                End Page <span class="mst-req">*</span>
                <span class="mst-hint-tooltip" data-tip="Last page number to export">?</span>
              </label>
              <input type="number" id="mstInputEndPage" class="mst-parser-input" min="1" max="${parserScannedInfo.totalPages}" value="${parserScannedInfo.totalPages}">
            </div>
          </div>

          <!-- Live Progress Section -->
          <div class="mst-parser-progress" id="mstParserProgress">
            <div class="mst-progress-status-text">
              <span id="mstProgressText">Ready</span>
              <span id="mstProgressPercent">0%</span>
            </div>
            <div class="mst-progress-bar-bg">
              <div class="mst-progress-bar-fill" id="mstProgressBarFill"></div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="mst-parser-footer">
          <button class="mst-btn mst-btn-secondary" id="mstBtnCancelParser" type="button">Close</button>
          <button class="mst-btn mst-btn-teal" id="mstBtnRunParser" type="button">🚀 Start Export (${parserScannedInfo.totalPages} pages)</button>
        </div>
      </div>
    `;

    // Make Draggable
    const windowCard = document.getElementById('mstParserWindow');
    const dragHeader = document.getElementById('mstParserDragHeader');
    if (windowCard && dragHeader) {
      makeElementDraggable(windowCard, dragHeader);
    }

    // Attach Event Handlers
    document.getElementById('mstParserCloseX')?.addEventListener('click', closeHtmlParserModal);
    document.getElementById('mstBtnCancelParser')?.addEventListener('click', closeHtmlParserModal);

    const startInput = document.getElementById('mstInputStartPage');
    const endInput = document.getElementById('mstInputEndPage');

    startInput?.addEventListener('input', () => {
      updateParserNamingPreview();
      updateParserRunBtnState();
    });
    endInput?.addEventListener('input', () => {
      updateParserRunBtnState();
    });

    // Re-sync chapter title button
    const btnSync = document.getElementById('mstBtnSyncChapter');
    btnSync?.addEventListener('click', () => {
      parserScannedInfo = scanChapterInfo();
      const chapterDisplay = document.getElementById('mstParserChapterDisplay');
      const subfolderInput = document.getElementById('mstInputSubfolder');
      if (chapterDisplay) chapterDisplay.textContent = parserScannedInfo.chapterTitle;
      if (subfolderInput) subfolderInput.value = sanitizeFilename(parserScannedInfo.chapterTitle);
      updateParserNamingPreview();
    });

    // Prefix Controls Listeners
    const chkPrefixDisable = document.getElementById('mstChkPrefixDisable');
    const prefixPillContainer = document.getElementById('mstPrefixPillContainer');
    const prefixControls = document.getElementById('mstPrefixControls');
    const btnOpenPrefix = document.getElementById('mstBtnOpenPrefix');

    function setPrefixDisabled(disabled) {
      parserNamingState.prefixDisabled = disabled;
      if (chkPrefixDisable) chkPrefixDisable.checked = disabled;
      prefixPillContainer?.classList.toggle('mst-collapsed', !disabled);
      prefixControls?.classList.toggle('mst-collapsed', disabled);
      updateParserNamingPreview();
    }

    chkPrefixDisable?.addEventListener('change', (e) => {
      setPrefixDisabled(e.target.checked);
    });
    btnOpenPrefix?.addEventListener('click', () => {
      setPrefixDisabled(false);
    });

    const inputPrefix = document.getElementById('mstInputPrefix');
    inputPrefix?.addEventListener('input', (e) => {
      parserNamingState.prefixVal = e.target.value;
      updateParserNamingPreview();
    });

    const chkPrefixInc = document.getElementById('mstChkPrefixInc');
    chkPrefixInc?.addEventListener('change', (e) => {
      parserNamingState.prefixAutoIncrement = e.target.checked;
      updateParserNamingPreview();
    });

    // Base Name Controls Listeners
    const inputName = document.getElementById('mstInputName');
    inputName?.addEventListener('input', (e) => {
      parserNamingState.nameVal = e.target.value;
      updateParserNamingPreview();
    });

    const chkUseSitePageName = document.getElementById('mstChkUseSitePageName');
    const nameHint = document.getElementById('mstNameHint');
    chkUseSitePageName?.addEventListener('change', (e) => {
      parserNamingState.useSitePageName = e.target.checked;
      if (nameHint) {
        nameHint.textContent = parserNamingState.useSitePageName ? '✨ Parsed from page header' : 'Custom entered name';
      }
      updateParserNamingPreview();
    });

    // Suffix Controls Listeners
    const chkSuffixDisable = document.getElementById('mstChkSuffixDisable');
    const suffixPillContainer = document.getElementById('mstSuffixPillContainer');
    const suffixControls = document.getElementById('mstSuffixControls');
    const btnOpenSuffix = document.getElementById('mstBtnOpenSuffix');

    function setSuffixDisabled(disabled) {
      parserNamingState.suffixDisabled = disabled;
      if (chkSuffixDisable) chkSuffixDisable.checked = disabled;
      suffixPillContainer?.classList.toggle('mst-collapsed', !disabled);
      suffixControls?.classList.toggle('mst-collapsed', disabled);
      updateParserNamingPreview();
    }

    chkSuffixDisable?.addEventListener('change', (e) => {
      setSuffixDisabled(e.target.checked);
    });
    btnOpenSuffix?.addEventListener('click', () => {
      setSuffixDisabled(false);
    });

    const inputSuffix = document.getElementById('mstInputSuffix');
    inputSuffix?.addEventListener('input', (e) => {
      parserNamingState.suffixVal = e.target.value;
      updateParserNamingPreview();
    });

    const chkSuffixInc = document.getElementById('mstChkSuffixInc');
    chkSuffixInc?.addEventListener('change', (e) => {
      parserNamingState.suffixAutoIncrement = e.target.checked;
      updateParserNamingPreview();
    });

    const selectPadDigits = document.getElementById('mstSelectPadDigits');
    selectPadDigits?.addEventListener('change', (e) => {
      parserNamingState.padDigits = parseInt(e.target.value, 10) || 3;
      updateParserNamingPreview();
    });

    updateParserNamingPreview();

    const runBtn = document.getElementById('mstBtnRunParser');
    runBtn?.addEventListener('click', () => {
      if (isHtmlScrapingActive) {
        isHtmlScrapingActive = false;
        runBtn.textContent = 'Stopping...';
        runBtn.disabled = true;
      } else {
        runHtmlScraper();
      }
    });
  }

  async function runHtmlScraper() {
    if (!parserScannedInfo) return;

    const startInput = document.getElementById('mstInputStartPage');
    const endInput = document.getElementById('mstInputEndPage');
    const subfolderInput = document.getElementById('mstInputSubfolder');

    const startPage = parseInt(startInput?.value, 10) || 1;
    const endPage = parseInt(endInput?.value, 10) || parserScannedInfo.totalPages;
    const subfolder = subfolderInput?.value?.trim() || '';

    const progressBox = document.getElementById('mstParserProgress');
    const progressBarFill = document.getElementById('mstProgressBarFill');
    const progressText = document.getElementById('mstProgressText');
    const progressPercent = document.getElementById('mstProgressPercent');
    const runBtn = document.getElementById('mstBtnRunParser');
    const closeBtn = document.getElementById('mstBtnCancelParser');

    if (progressBox) progressBox.style.display = 'flex';
    if (runBtn) {
      runBtn.textContent = '⏹️ Stop Export';
      runBtn.className = 'mst-btn mst-btn-danger';
      runBtn.disabled = false;
    }
    if (closeBtn) closeBtn.disabled = true;

    isHtmlScrapingActive = true;
    let savedCount = 0;
    let lastExportedHtml = '';
    const totalToScrape = Math.max(1, endPage - startPage + 1);

    for (let p = startPage; p <= endPage; p++) {
      if (!isHtmlScrapingActive) break;

      const currentStep = p - startPage + 1;
      const pct = Math.round(((currentStep - 0.5) / totalToScrape) * 100);
      if (progressText) progressText.textContent = `Navigating to Page ${p} (${currentStep}/${totalToScrape})...`;
      if (progressPercent) progressPercent.textContent = `${pct}%`;
      if (progressBarFill) progressBarFill.style.width = `${pct}%`;

      // 1. Find sidebar page card and navigate
      const sidebarPages = getSidebarPageList();
      const targetPage = sidebarPages.find(item => item.pageNum === p) || sidebarPages[p - 1];

      if (targetPage && targetPage.element) {
        if (!targetPage.isCurrent) {
          if (typeof targetPage.element.scrollIntoView === 'function') {
            targetPage.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
          triggerClick(targetPage.element);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (!isHtmlScrapingActive) break;

      // 2. Ensure we switch to HTML tab (3rd navbar button <> HTML)
      switchToHtmlTab();

      // 3. Focus edit_panel and wait until CodeMirror is POPULATED with actual page HTML
      if (progressText) progressText.textContent = `Loading HTML for Page ${p}...`;
      const htmlCode = await waitForPopulatedCodeMirror(12000, lastExportedHtml);

      if (!isHtmlScrapingActive) break;

      lastExportedHtml = htmlCode;

      // 4. Read current page title from page header
      const pageSiteTitle = extractCurrentSitePageName(p);

      // 5. Generate filename from user naming settings
      const fileName = generatePageFilename(p, pageSiteTitle);

      // 6. Directly save file on machine
      try {
        await saveHtmlFileToMachine(fileName, htmlCode, subfolder);
        savedCount++;
      } catch (writeErr) {
        console.error('Failed to download file:', fileName, writeErr);
      }

      const completedPct = Math.round((currentStep / totalToScrape) * 100);
      if (progressText) progressText.textContent = `Page ${p} exported (${htmlCode.length} bytes)! (${currentStep}/${totalToScrape})`;
      if (progressPercent) progressPercent.textContent = `${completedPct}%`;
      if (progressBarFill) progressBarFill.style.width = `${completedPct}%`;

      await new Promise(r => setTimeout(r, 400));
    }

    const wasActive = isHtmlScrapingActive;
    isHtmlScrapingActive = false;

    if (runBtn) {
      runBtn.textContent = `🚀 Start Export (${parserScannedInfo.totalPages} pages)`;
      runBtn.className = 'mst-btn mst-btn-teal';
      updateParserRunBtnState();
    }
    if (closeBtn) closeBtn.disabled = false;

    if (wasActive) {
      if (progressText) progressText.textContent = `Completed! ${savedCount} pages exported directly to machine.`;
      showToast('🎉', 'Export Complete!', `${savedCount} pages downloaded`);
    } else {
      if (progressText) progressText.textContent = `Stopped. ${savedCount} pages exported.`;
      showToast('⏹️', 'Export Stopped', `${savedCount} pages downloaded`);
    }
  }

})();

