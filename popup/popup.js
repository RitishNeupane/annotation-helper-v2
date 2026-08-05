// popup.js - mySecondTeacher Annotation Helper Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  const masterToggle = document.getElementById('masterToggle');
  const toggleSpace = document.getElementById('toggleSpace');
  const toggleNumbers = document.getElementById('toggleNumbers');
  const toggleBrackets = document.getElementById('toggleBrackets');
  const toggleSave = document.getElementById('toggleSave');
  const toggleSeek = document.getElementById('toggleSeek');
  const toggleSpeed = document.getElementById('toggleSpeed');
  
  const seekStepInput = document.getElementById('seekStepInput');
  const speedStepInput = document.getElementById('speedStepInput');
  const toggleToast = document.getElementById('toggleToast');
  
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  const defaultSettings = {
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

  // Check current tab URL for status badge
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        const url = tabs[0].url;
        if (url.startsWith('https://publishing.mysecondteacher.com/')) {
          statusBadge.classList.add('active');
          statusText.textContent = 'Active on MST';
        } else {
          statusBadge.classList.remove('active');
          statusBadge.style.background = 'rgba(239, 68, 68, 0.12)';
          statusBadge.style.color = '#ef4444';
          const dot = statusBadge.querySelector('.status-dot');
          if (dot) {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = '0 0 6px #ef4444';
          }
          statusText.textContent = 'Inactive (Not MST)';
        }
      }
    });
  }

  // Load Settings
  chrome.storage.sync.get(defaultSettings, (stored) => {
    masterToggle.checked = stored.enabled;
    toggleSpace.checked = stored.shortcutSpace;
    toggleNumbers.checked = stored.shortcutNumbers;
    toggleBrackets.checked = stored.shortcutBrackets;
    toggleSave.checked = stored.shortcutSave;
    toggleSeek.checked = stored.shortcutSeek;
    toggleSpeed.checked = stored.shortcutSpeed;

    seekStepInput.value = stored.seekStep || 5;
    speedStepInput.value = stored.speedStep || 0.5;
    toggleToast.checked = stored.showToast;
  });

  // Save Settings Function
  function saveSettings() {
    const updated = {
      enabled: masterToggle.checked,
      shortcutSpace: toggleSpace.checked,
      shortcutNumbers: toggleNumbers.checked,
      shortcutBrackets: toggleBrackets.checked,
      shortcutSave: toggleSave.checked,
      shortcutSeek: toggleSeek.checked,
      shortcutSpeed: toggleSpeed.checked,
      seekStep: Math.max(1, parseInt(seekStepInput.value, 10) || 5),
      speedStep: Math.max(0.1, parseFloat(speedStepInput.value) || 0.5),
      showToast: toggleToast.checked
    };

    chrome.storage.sync.set(updated);
  }

  // Attach Event Listeners
  const inputs = [
    masterToggle,
    toggleSpace,
    toggleNumbers,
    toggleBrackets,
    toggleSave,
    toggleSeek,
    toggleSpeed,
    seekStepInput,
    speedStepInput,
    toggleToast
  ];

  inputs.forEach(input => {
    input.addEventListener('change', saveSettings);
  });
});
