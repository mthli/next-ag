export default defineBackground(() => {
  // Open side panel when extension icon is clicked.
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) {
      browser.sidePanel.open({ tabId: tab.id });
    }
  });
});
