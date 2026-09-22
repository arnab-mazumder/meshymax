import { convertMeshy, isMeshyFile, isGlbFile } from './lib/converter.js';

// In-memory set of processed task IDs to avoid duplicate downloads
const processedTasks = new Set();

// Set default configuration on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['autoConvert', 'conversionCount'], (res) => {
    if (res.autoConvert === undefined) {
      chrome.storage.local.set({ autoConvert: true });
    }
    if (res.conversionCount === undefined) {
      chrome.storage.local.set({ conversionCount: 0 });
    }
  });
});

// Utility to convert ArrayBuffer to Base64 Data URL
function arrayBufferToDataUrl(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32k chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return 'data:model/gltf-binary;base64,' + btoa(binary);
}

// Extract Task ID from meshy asset URL
function extractTaskId(url) {
  if (!url) return null;
  const match = url.match(/\/tasks\/([^/]+)\/output\/model\.meshy/);
  return match ? match[1] : null;
}

// Network Interceptor: Listen for model.meshy responses
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    try {
      const url = details.url;
      if (!url || !url.includes('/output/model.meshy')) return;

      const taskId = extractTaskId(url) || `model_${Date.now()}`;
      if (processedTasks.has(taskId)) return;

      // Check if auto-convert slider is ON
      const { autoConvert } = await chrome.storage.local.get('autoConvert');
      if (autoConvert === false) return;

      // Mark as processed immediately to prevent duplicate fetches
      processedTasks.add(taskId);
      console.log(`[Meshy Extension] Intercepted .meshy model for task: ${taskId}`);

      // Fetch model binary
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      
      const inputBuffer = await response.arrayBuffer();

      // Convert .meshy container & meshopt streams to uncompressed GLB
      const glbBuffer = await convertMeshy(inputBuffer);
      const dataUrl = arrayBufferToDataUrl(glbBuffer);

      // Trigger automatic browser download
      const filename = `meshy_${taskId}.glb`;
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[Meshy Extension] Download error:', chrome.runtime.lastError);
        } else {
          console.log(`[Meshy Extension] Download triggered (ID: ${downloadId}) for ${filename}`);
          
          // Update stats in storage
          chrome.storage.local.get('conversionCount', (data) => {
            const newCount = (data.conversionCount || 0) + 1;
            chrome.storage.local.set({
              conversionCount: newCount,
              lastConverted: {
                taskId,
                filename,
                timestamp: Date.now()
              }
            });
          });

          // Show quick badge feedback
          chrome.action.setBadgeText({ text: '✓' });
          chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
          setTimeout(() => {
            chrome.action.setBadgeText({ text: '' });
          }, 3000);
        }
      });
    } catch (err) {
      console.error('[Meshy Extension] Conversion failed:', err);
    }
  },
  {
    urls: [
      '*://assets.meshy.ai/*',
      '*://*.meshy.ai/*'
    ]
  }
);
