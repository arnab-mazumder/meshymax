/**
 * Meshy Auto-Converter — Frontend Application
 * WebSocket-driven dashboard for real-time browser status, conversion queue, history.
 * Optimized: no network log rendering, minimal WebSocket traffic, Full Website mode.
 */

// ── WEBSOCKET CONNECTION ──────────────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;
let autoConvertEnabled = false;
let currentViewMode = 'full'; // Default to Full Website mode

function connectWebSocket() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer'; // receive screencast frames as binary, not base64 text

  ws.onopen = () => {
    console.log('[WS] Connected');
    clearTimeout(wsReconnectTimer);
  };

  ws.onmessage = (event) => {
    // Binary message = screencast frame (JPEG bytes)
    if (event.data instanceof ArrayBuffer) {
      updateScreencastBinary(event.data);
      return;
    }
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

  ws.onerror = () => {};
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
    // 'screencast_frame' is no longer sent as JSON — handled as binary ArrayBuffer
    case 'model_detected':
      showToast(`🔍 Model detected: ${data.taskId}`, 'info');
      break;
    case 'conversion_started':
      updateActiveTask(data.task);
      updateFloatingActive(data.task);
      break;
    case 'conversion_progress':
      updateActiveTask(data.task);
      updateFloatingActive(data.task);
      break;
    case 'conversion_completed':
      updateActiveTask(data.task);
      addOrUpdateHistory(data.task);
      triggerAutoDownload(data.task.taskId, data.filename);
      showToast(`✓ ${data.filename} ready`, 'success');
      setTimeout(() => hideActiveTask(), 2000);
      break;
    case 'conversion_failed':
      updateActiveTask(data.task);
      addOrUpdateHistory(data.task);
      showToast(`✕ Conversion failed: ${data.error}`, 'error');
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
      updateFloatingMonitorStatus();
      break;
    default:
      break;
  }
}

function applyInitState(state) {
  updateBrowserStatus(state.status);
  autoConvertEnabled = state.autoConvert ?? true;
  document.getElementById('autoconvert-toggle').checked = autoConvertEnabled;
  updateFloatingMonitorStatus();

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
  const labelEl = document.getElementById('status-label');

  globalEl.className = `status-pill ${statusClass}`;
  labelEl.textContent = status;

  if (status === 'Disconnected' || status === 'Error') {
    const placeholder = document.getElementById('browser-placeholder');
    const screencastImg = document.getElementById('screencast-img');
    placeholder.style.display = 'flex';
    screencastImg.style.display = 'none';
    _screencastVisible = false; // reset visibility flag
  }
}

// ── SCREENCAST ────────────────────────────────────────────────────────────────
let _screencastVisible = false; // track visibility without touching the DOM
let _currentFrameUrl = null;    // track current Blob URL so we can revoke it

/** Called for binary ArrayBuffer WebSocket messages (JPEG frame bytes) */
function updateScreencastBinary(arrayBuffer) {
  const img = document.getElementById('screencast-img');
  const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  img.src = url;

  // Revoke the previous Blob URL once the new image loads to free memory
  img.onload = () => {
    if (_currentFrameUrl) URL.revokeObjectURL(_currentFrameUrl);
    _currentFrameUrl = url;
  };

  if (!_screencastVisible) {
    img.style.display = 'block';
    document.getElementById('browser-placeholder').style.display = 'none';
    _screencastVisible = true;
  }
}

/** Legacy fallback for base64 frames (unused when binary WS is active) */
function updateScreencast(base64Frame) {
  const img = document.getElementById('screencast-img');
  img.src = `data:image/jpeg;base64,${base64Frame}`;
  if (!_screencastVisible) {
    img.style.display = 'block';
    document.getElementById('browser-placeholder').style.display = 'none';
    _screencastVisible = true;
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
  // Hide floating active too
  const fa = document.getElementById('floating-active');
  if (fa) fa.style.display = 'none';
}

// ── FLOATING PANEL ────────────────────────────────────────────────────────────
function updateFloatingActive(task) {
  const el = document.getElementById('floating-active');
  if (!el) return;
  el.style.display = 'block';
  document.getElementById('floating-task-id').textContent = task.taskId;
  document.getElementById('floating-progress-bar').style.width = `${task.progress || 0}%`;
}

function updateFloatingMonitorStatus() {
  const el = document.getElementById('floating-monitor-status');
  if (!el) return;
  const dot = document.getElementById('floating-status-dot');
  if (autoConvertEnabled) {
    el.textContent = '● ON';
    el.style.color = 'var(--status-ready)';
    if (dot) dot.style.background = 'var(--status-ready)';
  } else {
    el.textContent = '● OFF';
    el.style.color = 'var(--status-error)';
    if (dot) dot.style.background = 'var(--status-error)';
  }
}

function updateFloatingDownloads() {
  const container = document.getElementById('floating-downloads');
  if (!container) return;
  const completed = Array.from(historyData.values()).filter(t => t.status === 'Completed');
  const badge = document.getElementById('floating-badge');
  if (badge) badge.textContent = completed.length;

  if (completed.length === 0) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); text-align:center;">No downloads yet</div>';
    return;
  }

  container.innerHTML = completed.slice(0, 5).map(t => `
    <div class="floating-download-item">
      <span class="task-id-tag">${t.filename || t.taskId + '.glb'}</span>
      <button class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:10px;" onclick="downloadTask('${t.taskId}')">↓</button>
    </div>
  `).join('');
}

function toggleFloatingPanel() {
  const panel = document.getElementById('floating-panel');
  panel.classList.toggle('collapsed');
}

// ── CONVERSION HISTORY ────────────────────────────────────────────────────────
const historyData = new Map();

function addOrUpdateHistory(task) {
  historyData.set(task.taskId, task);
  renderHistory();
  updateFloatingDownloads();
}

function removeHistoryItem(taskId) {
  historyData.delete(taskId);
  renderHistory();
  updateFloatingDownloads();
}

function clearHistoryUI() {
  historyData.clear();
  renderHistory();
  updateFloatingDownloads();
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

  // Keyed update: add/update individual items instead of rebuilding the entire list.
  // This avoids layout thrashing on every conversion_progress WebSocket event.
  const existingIds = new Set(Array.from(container.children).map(el => el.dataset.taskId));
  const incomingIds = new Set(tasks.map(t => t.taskId));

  // Remove stale items
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      container.querySelector(`[data-task-id="${id}"]`)?.remove();
    }
  }

  // Add or update each task
  tasks.forEach(task => {
    const html = `
      <div class="history-item" style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
              ${statusIcon(task.status)}
              <span class="task-id-tag" style="font-size:12px;">${task.filename || task.taskId + '.glb'}</span>
            </div>
            <div style="font-size:10px; color:var(--text-dim);">
              ${formatTime(task.timestamp)} · ${formatSize(task.sizeBytes)}
              ${task.error ? `<span style="color:var(--status-error);"> · ${task.error}</span>` : ''}
            </div>
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            ${task.status === 'Completed' ? `<button class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:10px;" onclick="downloadTask('${task.taskId}')">↓</button>` : ''}
            <button class="btn btn-sm" style="padding:2px 6px; font-size:10px;" onclick="deleteTask('${task.taskId}')">✕</button>
          </div>
        </div>
      </div>`;

    const existing = container.querySelector(`[data-task-id="${task.taskId}"]`);
    if (existing) {
      // Update only the content of the existing row wrapper — no DOM node removal/insertion
      existing.innerHTML = html;
    } else {
      const wrapper = document.createElement('div');
      wrapper.dataset.taskId = task.taskId;
      wrapper.innerHTML = html;
      container.appendChild(wrapper);
    }
  });
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
  updateFloatingDownloads();
}

async function clearHistory() {
  await fetch('/api/history/clear', { method: 'POST' });
  clearHistoryUI();
}

// ── BROWSER CONTROLS ──────────────────────────────────────────────────────────
function launchBrowser() {
  showToast('Launching Meshy browser…', 'info');
  sendWsMessage({ type: 'launch_browser' });
}

function reconnectBrowser() {
  showToast('Reconnecting…', 'info');
  sendWsMessage({ type: 'reconnect_browser' });
}

function closeBrowser() {
  sendWsMessage({ type: 'close_browser' });
}

// ── VIEW MODE ─────────────────────────────────────────────────────────────────
function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('meshy-view-mode', mode);

  const btnDash = document.getElementById('btn-dashboard');
  const btnFull = document.getElementById('btn-fullsite');

  if (mode === 'full') {
    document.body.classList.add('mode-full');
    btnDash.classList.remove('active');
    btnFull.classList.add('active');
  } else {
    document.body.classList.remove('mode-full');
    btnDash.classList.add('active');
    btnFull.classList.remove('active');
    // Close floating panel
    document.getElementById('floating-panel').classList.add('collapsed');
  }
}

// ── BROWSER INTERACTION (click, drag, orbit, wheel, keyboard) ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  const screencastImg = document.getElementById('screencast-img');
  let isMouseDown = false;
  let mouseDownPos = { x: 0, y: 0 };
  let lastMoveTime = 0;

  // Prevent browser image dragging and touch scrolling interference
  screencastImg.style.userSelect = 'none';
  screencastImg.style.webkitUserDrag = 'none';
  screencastImg.style.touchAction = 'none';

  function getBrowserCoords(e) {
    const rect = screencastImg.getBoundingClientRect();
    const nativeWidth = screencastImg.naturalWidth || 1440;
    const nativeHeight = screencastImg.naturalHeight || 900;
    const scaleX = nativeWidth / rect.width;
    const scaleY = nativeHeight / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    };
  }

  screencastImg.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    const { x, y } = getBrowserCoords(e);
    mouseDownPos = { x, y };
    const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
    sendWsMessage({ type: 'browser_interact', interaction: { type: 'mousedown', x, y, button } });
  });

  screencastImg.addEventListener('mousemove', (e) => {
    const now = Date.now();
    const interval = isMouseDown ? 16 : 33; // ~60Hz when dragging, ~30Hz when hovering
    if (now - lastMoveTime < interval) return;
    lastMoveTime = now;
    const { x, y } = getBrowserCoords(e);
    sendWsMessage({ type: 'browser_interact', interaction: { type: 'mousemove', x, y } });
  });

  window.addEventListener('mouseup', (e) => {
    if (isMouseDown) {
      isMouseDown = false;
      const { x, y } = getBrowserCoords(e);
      const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
      const dist = Math.hypot(x - mouseDownPos.x, y - mouseDownPos.y);
      if (dist < 6) {
        // Precise click for UI controls, checkboxes, CAPTCHAs & inputs
        sendWsMessage({ type: 'browser_interact', interaction: { type: 'click', x, y, button } });
      } else {
        // Drag end for 3D view orbit / panning
        sendWsMessage({ type: 'browser_interact', interaction: { type: 'mouseup', x, y, button } });
      }
    }
  });

  screencastImg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  screencastImg.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendWsMessage({
      type: 'browser_interact',
      interaction: { type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY }
    });
  }, { passive: false });

  // Keyboard forwarding — don't intercept local inputs
  window.addEventListener('keydown', (e) => {
    // Ctrl+Shift+F toggles Full Website mode
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      setViewMode(currentViewMode === 'full' ? 'dashboard' : 'full');
      return;
    }

    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (screencastImg.style.display !== 'none') {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) return;
      sendWsMessage({ type: 'browser_interact', interaction: { type: 'keydown', key: e.key } });
    }
  });

  // Auto-convert toggle
  document.getElementById('autoconvert-toggle').addEventListener('change', function() {
    const enabled = this.checked;
    sendWsMessage({ type: 'set_autoconvert', enabled });
    localStorage.setItem('autoConvertEnabled', JSON.stringify(enabled));
    autoConvertEnabled = enabled;
    updateFloatingMonitorStatus();
  });

  // Restore preferences
  const savedPref = localStorage.getItem('autoConvertEnabled');
  if (savedPref !== null) {
    autoConvertEnabled = JSON.parse(savedPref);
    document.getElementById('autoconvert-toggle').checked = autoConvertEnabled;
  }

  const savedViewMode = localStorage.getItem('meshy-view-mode') || 'full';
  setViewMode(savedViewMode);

  // Button wiring
  document.getElementById('btn-launch').onclick = launchBrowser;
  document.getElementById('btn-reconnect').onclick = reconnectBrowser;
  document.getElementById('btn-close').onclick = closeBrowser;

  // Start WebSocket
  connectWebSocket();

  // Initialize floating panel state
  updateFloatingMonitorStatus();
  updateFloatingDownloads();
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
  btn.textContent = '⟳';
  showToast('Fetching and converting…', 'info');

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
    btn.textContent = 'Convert';
  }
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
