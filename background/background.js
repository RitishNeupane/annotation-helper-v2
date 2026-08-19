// Background service worker for mySecondTeacher Annotation Helper (v1.4.0)

const DEFAULT_SETTINGS = {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
  });
});
