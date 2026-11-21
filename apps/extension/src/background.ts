chrome.action.onClicked.addListener(async ({ id }) => {
  if (id === undefined) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['overlay.js'] });
    await chrome.action.setBadgeText({ tabId: id, text: '' });
  } catch (error) {
    console.warn('No se pudo abrir FactChecking en esta pestaña.', error);
    await chrome.action.setBadgeText({ tabId: id, text: '×' });
  }
});
