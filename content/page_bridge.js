// content/page_bridge.js - Runs in MAIN execution world (page context)
// Has direct access to window.CodeMirror and DOM element .CodeMirror properties
(function() {
  'use strict';

  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data || event.data.type !== 'MST_REQ_CODEMIRROR') {
      return;
    }

    const reqId = event.data.reqId;

    try {
      // 1. Focus edit panel if present
      const editPanel = document.querySelector('.edit_panel, [class*="edit_panel"], [class*="MuiBox-root"][class*="edit_panel"]');
      if (editPanel && typeof editPanel.focus === 'function') {
        editPanel.focus();
      }

      // 2. Find CodeMirror instance on DOM element
      const cmEl = document.querySelector('.CodeMirror');
      let code = '';

      if (cmEl && cmEl.CodeMirror) {
        const cm = cmEl.CodeMirror;
        cm.focus();
        cm.execCommand('selectAll');
        code = cm.getSelection() || cm.getValue() || '';
        cm.setCursor(0, 0); // Deselect cleanly so nothing is altered
      }

      // 3. Fallback: Check textarea
      if (!code && cmEl) {
        const ta = cmEl.querySelector('textarea');
        if (ta && ta.value) {
          code = ta.value;
        }
      }

      // 4. Respond back to content script
      window.postMessage({
        type: 'MST_RESP_CODEMIRROR',
        reqId: reqId,
        code: code,
        success: Boolean(code && code.length > 50)
      }, '*');

    } catch (err) {
      window.postMessage({
        type: 'MST_RESP_CODEMIRROR',
        reqId: reqId,
        code: '',
        error: err.message,
        success: false
      }, '*');
    }
  });

})();
