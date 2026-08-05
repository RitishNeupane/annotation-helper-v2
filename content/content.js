// content.js - mySecondTeacher Annotation Helper Content Script (v1.2.0)

(function () {
  'use strict';

  // Extension Settings Defaults
  let settings = {
    enabled: true,
    shortcutSpace: true,
    shortcutNumbers: true,
    shortcutBrackets: true,
    shortcutSave: true,
    shortcutSeek: true,
    shortcutSpeed: true,
    seekStep: 5,
    speedStep: 0.5,
    autoUpdate: false,
    showToast: true,
    precision: 3
  };

  // Extension State
  let selectedIndex = 1; // 1-based index of selected card
  let hudContainer = null;

  // Load Settings
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
      }
    });
  } else {
    initExtension();
  }

  function initExtension() {
    createHudContainer();
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
      // Exclude SVGs inside annotation cards
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

    // Blur focus so typing cursor is NOT left inside start/end time inputs!
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
    
    // Find Save or Update or Add button
    let targetBtn = buttons.find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text.includes('save') || text.includes('update') || text.includes('add');
    });

    // Fallback: find any button in card that isn't Remove/Delete
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

  // --- Main Keyboard Event Listener ---
  function handleKeyDown(e) {
    if (!settings.enabled) return;

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

    // Bypass remaining shortcuts if user is actively typing in a non-annotation text field (e.g. section title input)
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

    // 4: Square Brackets [ and ] to set start and end times
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
      showToast('⏱️', `Annotation #${selectedIndex} End Time:`, formatTimeDisplay(curTime));
      return;
    }

    // 5: Side Arrow Keys (Left / Right) to seek 5 seconds
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

    // 6: Up and Down Arrow Keys to speed up or slow down playback rate
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
