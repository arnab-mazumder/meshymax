document.addEventListener('DOMContentLoaded', () => {
  const toggleSwitch = document.getElementById('toggle-switch');
  const statusText = document.getElementById('status-text');
  const viewerBtn = document.getElementById('viewer-btn');

  // Load current autoConvert state
  chrome.storage.local.get('autoConvert', (res) => {
    const isEnabled = res.autoConvert !== false; // Default true
    toggleSwitch.checked = isEnabled;
    updateStatusUI(isEnabled);
  });

  // Handle Toggle Switch Change
  toggleSwitch.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ autoConvert: isEnabled }, () => {
      updateStatusUI(isEnabled);
    });
  });

  // Update Status Badge UI
  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusText.textContent = 'ON';
      statusText.className = 'status-badge active';
    } else {
      statusText.textContent = 'DISABLED';
      statusText.className = 'status-badge disabled';
    }
  }

  // Handle Viewer Link click cleanly inside Chrome Extension popup
  viewerBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const targetUrl = 'https://imeshh.com/tools/gltf-viewer';
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  });
});
