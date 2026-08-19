// content.js - mySecondTeacher Annotation Helper Content Script (v1.4.0)

(function () {
  'use strict';

  // --- Extension Settings Defaults ---
  let settings = {
    enabled: true,
    shortcutSpace: true,
    shortcutNumbers: true,
    shortcutBrackets: true,
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
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
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

  // --- Dispatch React Native Input Event ---
  function setNativeInputValue(input, val) {
    if (!input) return;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(input, val);
    } else {
      input.value = val;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
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
      const startInput = card.querySelector('input[name="startTime"]');
      const endInput = card.querySelector('input[name="endTime"]');

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
      if (e.target.closest('button')) return; // Don't drag if clicking close or action buttons
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = windowCard.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      windowCard.style.right = 'auto'; // Switch from right anchoring to absolute left/top
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

  // Row move operation: Splice and Shift (Drag item to new slot, shifting all others down)
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
      version: "1.4.0",
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

      // Try parsing embedded JSON block first
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

      // Try raw JSON parse if file was pure JSON
      if (!importedList) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) importedList = data;
          else if (data && Array.isArray(data.timings)) importedList = data.timings;
        } catch (e) {}
      }

      // Fallback: Parse line-by-line formatted text
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

      const startInput = card.querySelector('input[name="startTime"]');
      const endInput = card.querySelector('input[name="endTime"]');

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

    // Bypass remaining shortcuts if user is actively typing in a non-annotation text field
    if (isInputActive(e)) return;

    const mainAudio = getMainAudioElement();

    // 3: Number keys 1 to 9 to select audio annotations (NO INPUT FOCUS!)
    if (!e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      if (!settings.shortcutNumbers) return;
      e.preventDefault();
      e.stopPropagation();

      const cardIndex = parseInt(e.key, 10);
      selectAnnotationCard(cardIndex);
      return;
    }

    // 4: Square Bracket [ (Set Start Time)
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
      const startInput = selectedCard.querySelector('input[name="startTime"]');
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

    // 5: Square Bracket ] (Set End Time + Optional Deadline Mode Fast Flow)
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
      const endInput = selectedCard.querySelector('input[name="endTime"]');
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
        // 1. Auto-save the current annotation
        saveOrUpdateAnnotation(selectedCard, selectedIndex);

        // 2. Check if next annotation exists
        const nextIndex = selectedIndex + 1;
        if (nextIndex <= cards.length) {
          const delay = Math.max(0, parseFloat(settings.deadlineDelay) || 0.0);
          const nextStartTime = Number((curTime + delay).toFixed(settings.precision || 3));

          // 3. Move selection to next annotation
          selectAnnotationCard(nextIndex);

          // 4. Set start time on the next annotation card
          const nextCard = cards[nextIndex - 1];
          if (nextCard) {
            const nextStartInput = nextCard.querySelector('input[name="startTime"]');
            if (nextStartInput) {
              setNativeInputValue(nextStartInput, nextStartTime);
            }
          }

          showToast('⚡', `[Deadline] #${selectedIndex - 1} Saved ➔ #${selectedIndex} Start:`, formatTimeDisplay(nextStartTime));
        } else {
          showToast('🏁', `[Deadline] Final Annotation #${selectedIndex} Saved!`);
        }
      } else {
        // Standard non-deadline mode behavior
        showToast('⏱️', `Annotation #${selectedIndex} End Time:`, formatTimeDisplay(curTime));
      }
      return;
    }

    // 6: Side Arrow Keys (Left / Right) to seek 5 seconds
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
      const maxTime = mainAudio.duration || Infinity;
      const newTime = Math.min(maxTime, mainAudio.currentTime + (settings.seekStep || 5));
      mainAudio.currentTime = newTime;
      showToast('⏩', `Seek +${settings.seekStep || 5}s`, formatTimeDisplay(newTime));
      return;
    }

    // 7: Up and Down Arrow Keys to speed up or slow down playback rate
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

})();
