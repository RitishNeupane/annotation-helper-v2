// Background service worker for mySecondTeacher Annotation Helper

const DEFAULT_SETTINGS = {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
  });
});
