chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'aiq-create',
      title: 'Ask AI',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'aiq-create') return;
  const msg = { type: 'CREATE_WINDOW', selectionText: info.selectionText };

  chrome.tabs.sendMessage(tab.id, msg, () => {
    const err = chrome.runtime.lastError;
    if (!err || !err.message.includes('Receiving end does not exist')) return;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] }))
      .then(() => chrome.tabs.sendMessage(tab.id, msg))
      .catch(() => {});
  });
});
