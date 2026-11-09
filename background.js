// Chrome: opens the side panel when you click the toolbar icon.
// Safari / Orion on iPhone (no side panel there): the panel opens inside the page instead, from the
// Chess Coach button on the board page or from the extension's entry in the browser menu.
const hasSidePanel = !!chrome.sidePanel?.setPanelBehavior;

if (hasSidePanel) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });
} else {
  chrome.action?.onClicked?.addListener((tab) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'cc:toggle-panel' }).catch(() => {});
    }
  });
}

// content scripts ask which kind of panel to use. `forceInPagePanel` in storage lets you try the iPhone
// layout in desktop Chrome (the browser test uses it).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'cc:mode') {
    return false;
  }

  chrome.storage.local.get('forceInPagePanel')
    .then(({ forceInPagePanel }) => sendResponse({ inPage: !hasSidePanel || forceInPagePanel === true }))
    .catch(() => sendResponse({ inPage: !hasSidePanel }));

  return true;
});
