// Background service worker for mySecondTeacher Annotation Helper (v1.6.0)

const DEFAULT_SETTINGS = {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
  });
});

// Direct file download handler for HTML Publishing Parser
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'downloadFile') {
    try {
      if (chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download({
          url: message.url,
          filename: message.filename,
          saveAs: false,
          conflictAction: 'overwrite'
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, downloadId });
          }
        });
        return true; // Keep channel open for async response
      } else {
        sendResponse({ success: false, error: 'chrome.downloads not available' });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
});

