/**
 * Meshy Auto-Converter — Frontend Application
 * WebSocket-driven dashboard for real-time browser status, conversion queue, history, and manual tools.
 */

// ── WEBSOCKET CONNECTION ──────────────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;
let autoConvertEnabled = true;

function connectWebSocket() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected');
    clearTimeout(wsReconnectTimer);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (err) {
      console.error('[WS] Message parse error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected — retrying in 3s...');
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
}

function sendWsMessage(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── EVENT HANDLING ────────────────────────────────────────────────────────────
function handleServerEvent(data) {
  switch (data.type) {
    case 'init_state':
      applyInitState(data);
      break;
    case 'meshy_status':
      updateBrowserStatus(data.status);
      break;
    case 'screencast_frame':
      updateScreencast(data.frame);
      break;
    case 'model_detected':
      appendNetworkLog({
        timestamp: data.timestamp,
        isMatch: true,
        method: 'GET',
        url: `tasks/${data.taskId}/output/model.meshy`,
        status: 200
      });
      showToast(`🔍 Model detected: task ${data.taskId}`, 'info');
      break;
    case 'conversion_started':
      updateActiveTask(data.task);
      break;
    case 'conversion_progress':
      updateActiveTask(data.task);
      break;
    case 'conversion_completed':
      updateActiveTask(data.task);
      addOrUpdateHistory(data.task);
      triggerAutoDownload(data.task.taskId, data.filename);
      showToast(`✓ ${data.filename} is ready`, 'success');
      setTimeout(() => hideActiveTask(), 2000);
      break;
    case 'conversion_failed':
      updateActiveTask(data.task);
      addOrUpdateHistory(data.task);
      showToast(`✕ Conversion failed for task ${data.taskId}: ${data.error}`, 'error');
      setTimeout(() => hideActiveTask(), 3000);
      break;
    case 'task_removed':
      removeHistoryItem(data.taskId);
      break;
    case 'history_cleared':
      clearHistoryUI();
      break;
    case 'autoconvert_changed':
      autoConvertEnabled = data.enabled;
      document.getElementById('autoconvert-toggle').checked = data.enabled;
      break;
    case 'network_log':
      appendNetworkLog(data.log);
      break;
    default:
      break;
  }
}

function applyInitState(state) {
  updateBrowserStatus(state.status);
  autoConvertEnabled = state.autoConvert ?? true;
  document.getElementById('autoconvert-toggle').checked = autoConvertEnabled;

  if (state.history && state.history.length > 0) {
    state.history.forEach(task => addOrUpdateHistory(task));
  }
}

// ── BROWSER STATUS ────────────────────────────────────────────────────────────
const STATUS_CLASSES = {
  'Disconnected': 'status-error',
  'Error': 'status-error',
  'Browser starting': 'status-waiting',
  'Waiting for login': 'status-waiting',
  'Meshy loading': 'status-waiting',
  'Ready': 'status-ready',
  'Monitoring': 'status-ready'
};

function updateBrowserStatus(status) {
  const statusClass = STATUS_CLASSES[status] || 'status-waiting';
  const globalEl = document.getElementById('global-status');
  const browserEl = document.getElementById('browser-state-badge');
  const labelEl = document.getElementById('status-label');
  const browserLabelEl = document.getElementById('browser-state-label');

  globalEl.className = `status-pill ${statusClass}`;
  browserEl.className = `status-pill ${statusClass}`;
  labelEl.textContent = status;
  browserLabelEl.textContent = status;

  const placeholder = document.getElementById('browser-placeholder');
  const screencastImg = document.getElementById('screencast-img');
  const hint = document.getElementById('browser-overlay-hint');

  if (status === 'Ready' || status === 'Monitoring') {
    hint.style.display = 'block';
  } else {
    hint.style.display = 'none';
  }

  if (status === 'Disconnected' || status === 'Error') {
    placeholder.style.display = 'flex';
    screencastImg.style.display = 'none';
  }
}

function updateScreencast(base64Frame) {
  const img = document.getElementById('screencast-img');
  const placeholder = document.getElementById('browser-placeholder');
  img.src = `data:image/jpeg;base64,${base64Frame}`;
  if (img.style.display === 'none') {
    img.style.display = 'block';
    placeholder.style.display = 'none';
  }
}

// ── ACTIVE CONVERSION DISPLAY ─────────────────────────────────────────────────
function updateActiveTask(task) {
  const card = document.getElementById('active-task-card');
  card.style.display = 'block';

  document.getElementById('active-task-id').textContent = task.taskId;
  document.getElementById('active-task-status').textContent =
    task.error ? `Error: ${task.error}` : task.status;
  document.getElementById('active-task-step').textContent = task.status;
  document.getElementById('active-task-pct').textContent = `${task.progress || 0}%`;
  document.getElementById('active-progress-bar').style.width = `${task.progress || 0}%`;
}

function hideActiveTask() {
  document.getElementById('active-task-card').style.display = 'none';
}

// ── CONVERSION HISTORY ────────────────────────────────────────────────────────
const historyData = new Map();

function addOrUpdateHistory(task) {
  historyData.set(task.taskId, task);
  renderHistory();
}

function removeHistoryItem(taskId) {
  historyData.delete(taskId);
  renderHistory();
}

function clearHistoryUI() {
  historyData.clear();
  renderHistory();
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusIcon(status) {
  if (status === 'Completed') return '<span style="color:var(--status-ready);">✓</span>';
  if (status === 'Failed') return '<span style="color:var(--status-error);">✕</span>';
  return '<span style="color:var(--status-waiting);">⟳</span>';
}

function renderHistory() {
  const container = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  const tasks = Array.from(historyData.values());

  if (tasks.length === 0) {
    emptyEl.style.display = 'block';
    container.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';

  container.innerHTML = tasks.map(task => `
    <div class="history-item" id="hist-${task.taskId}" style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            ${statusIcon(task.status)}
            <span class="task-id-tag" style="font-size:13px;">${task.filename || task.taskId + '.glb'}</span>
          </div>
          <div style="font-size:11px; color:var(--text-dim);">
            ${formatTime(task.timestamp)} · ${formatSize(task.sizeBytes)}
            ${task.error ? `<span style="color:var(--status-error);"> · ${task.error}</span>` : ''}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          ${task.status === 'Completed' ? `<button class="btn btn-sm btn-primary" onclick="downloadTask('${task.taskId}')">↓ Download</button>` : ''}
          ${task.status === 'Failed' ? `<button class="btn btn-sm" onclick="retryTask('${task.taskId}')">↺ Retry</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteTask('${task.taskId}')">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── DOWNLOAD ──────────────────────────────────────────────────────────────────
function triggerAutoDownload(taskId, filename) {
  const url = `/api/download/${taskId}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${taskId}.glb`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadTask(taskId) {
  triggerAutoDownload(taskId, `${taskId}.glb`);
}

async function deleteTask(taskId) {
  await fetch(`/api/history/${taskId}`, { method: 'DELETE' });
  historyData.delete(taskId);
  renderHistory();
}

async function retryTask(taskId) {
  showToast(`↺ Retry not yet supported for manual tasks. Please re-upload.`, 'info');
}

async function clearHistory() {
  await fetch('/api/history/clear', { method: 'POST' });
  clearHistoryUI();
}

// ── BROWSER CONTROLS ──────────────────────────────────────────────────────────
async function launchBrowser() {
  showToast('Launching Meshy browser…', 'info');
  sendWsMessage({ type: 'launch_browser' });
}

async function reconnectBrowser() {
  showToast('Reconnecting…', 'info');
  sendWsMessage({ type: 'reconnect_browser' });
}

async function closeBrowser() {
  sendWsMessage({ type: 'close_browser' });
}

// ── BROWSER INTERACTION (click on screencast to forward events) ──────────────
document.addEventListener('DOMContentLoaded', () => {
  const screencastImg = document.getElementById('screencast-img');
  const wrapper = document.getElementById('browser-wrapper');

  screencastImg.addEventListener('click', (e) => {
    const rect = screencastImg.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    sendWsMessage({ type: 'browser_interact', interaction: { type: 'click', x, y } });
  });

  screencastImg.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendWsMessage({ type: 'browser_interact', interaction: { type: 'scroll', deltaY: e.deltaY } });
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === document.body && screencastImg.style.display !== 'none') {
      sendWsMessage({ type: 'browser_interact', interaction: { type: 'keydown', key: e.key } });
    }
  });

  // Auto-convert toggle
  document.getElementById('autoconvert-toggle').addEventListener('change', function() {
    const enabled = this.checked;
    sendWsMessage({ type: 'set_autoconvert', enabled });

    // Persist in localStorage
    localStorage.setItem('autoConvertEnabled', JSON.stringify(enabled));
  });

  // Restore auto-convert preference
  const savedPref = localStorage.getItem('autoConvertEnabled');
  if (savedPref !== null) {
    autoConvertEnabled = JSON.parse(savedPref);
    document.getElementById('autoconvert-toggle').checked = autoConvertEnabled;
  }

  // Button wiring
  document.getElementById('btn-launch').onclick = launchBrowser;
  document.getElementById('btn-reconnect').onclick = reconnectBrowser;
  document.getElementById('btn-close').onclick = closeBrowser;

  // Start WebSocket
  connectWebSocket();
});

// ── MANUAL FILE UPLOAD ────────────────────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('dragover');
}

function handleDragLeave(e) {
  document.getElementById('dropzone').classList.remove('dragover');
}

async function handleFileDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    await uploadMeshyFile(files[0]);
  }
}

async function handleFileInput(e) {
  const file = e.target.files[0];
  if (file) {
    await uploadMeshyFile(file);
    e.target.value = '';
  }
}

async function uploadMeshyFile(file) {
  showToast(`Uploading ${file.name}…`, 'info');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/convert/file', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (data.success) {
      showToast(`✓ Conversion started for ${file.name}`, 'success');
    } else {
      showToast(`✕ Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`✕ Upload failed: ${err.message}`, 'error');
  }
}

// ── MANUAL URL CONVERSION ─────────────────────────────────────────────────────
async function convertUrl() {
  const url = document.getElementById('url-input').value.trim();
  const errorEl = document.getElementById('url-error');
  const btn = document.getElementById('btn-convert-url');

  errorEl.style.display = 'none';

  if (!url) {
    errorEl.textContent = 'Please enter a Meshy asset URL.';
    errorEl.style.display = 'block';
    return;
  }

  const meshyUrlPattern = /^https:\/\/assets\.meshy\.ai\/.+\/tasks\/.+\/output\/model\.meshy/;
  if (!meshyUrlPattern.test(url)) {
    errorEl.textContent = 'URL must match: https://assets.meshy.ai/…/tasks/…/output/model.meshy';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⟳ Fetching…';
  showToast('Fetching and converting model…', 'info');

  try {
    const response = await fetch('/api/convert/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();

    if (data.success) {
      document.getElementById('url-input').value = '';
      showToast(`✓ ${data.filename} ready`, 'success');
    } else {
      errorEl.textContent = data.error || 'Conversion failed.';
      errorEl.style.display = 'block';
      showToast(`✕ ${data.error}`, 'error');
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    showToast(`✕ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch & Convert';
  }
}

// ── NETWORK LOG ───────────────────────────────────────────────────────────────
const MAX_LOG_ENTRIES = 80;
const logEl = document.getElementById('network-log');

function appendNetworkLog(entry) {
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })
    : '--:--:--';
  const safeUrl = (entry.url || '').slice(0, 80);
  const method = entry.method || 'GET';
  const status = entry.status || '';

  const lineEl = document.createElement('div');
  lineEl.className = `log-entry${entry.isMatch ? ' match' : ''}`;
  lineEl.innerHTML = `<span class="log-time">${time}</span>${method} ${status} ${safeUrl}${entry.isMatch ? ' <span style="color:#fbbf24;">▲ MATCH</span>' : ''}`;
  logEl.appendChild(lineEl);

  // Trim older entries
  const entries = logEl.querySelectorAll('.log-entry');
  if (entries.length > MAX_LOG_ENTRIES) {
    entries[0].remove();
  }

  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  while (logEl.firstChild) logEl.removeChild(logEl.firstChild);
  const initEntry = document.createElement('div');
  initEntry.className = 'log-entry';
  initEntry.style.color = 'var(--text-dim)';
  initEntry.innerHTML = '<span class="log-time">--:--:--</span> Log cleared.';
  logEl.appendChild(initEntry);
}

// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
