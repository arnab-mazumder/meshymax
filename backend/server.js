import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';

import { MeshyBrowserController } from './browser.js';
import { NetworkMonitor, isMeshyModelUrl, extractTaskId } from './network-monitor.js';
import { ConverterService } from './converter-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB max
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(rootDir, 'frontend')));

// System Services Initialization
const converterService = new ConverterService({
  onTaskStateChange: (event) => broadcastWebSocket(event)
});
await converterService.init();

const networkMonitor = new NetworkMonitor({
  autoConvertEnabled: false,
  onModelDetected: ({ taskId, url, buffer, sizeBytes }) => {
    broadcastWebSocket({
      type: 'model_detected',
      taskId,
      sizeBytes,
      timestamp: new Date().toISOString()
    });

    // Fire-and-forget: don't await, don't block Playwright
    converterService.processConversion(taskId, buffer, 'auto').catch(err => {
      console.error(`[Server] Auto-conversion failed for ${taskId}:`, err.message);
    });
  }
});

const browserController = new MeshyBrowserController({
  networkMonitor,
  onStatusChange: (status) => {
    broadcastWebSocket({
      type: 'meshy_status',
      status: status
    });
  },
  onScreencastFrame: (frameBuffer) => {
    // Send as raw binary WebSocket message — no base64 overhead, no JSON parse
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frameBuffer, { binary: true });
      }
    });
  }
});

// WebSocket Broadcast Helper
function broadcastWebSocket(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected.');

  // Send initial state to newly connected client
  ws.send(JSON.stringify({
    type: 'init_state',
    status: browserController.getStatus(),
    autoConvert: networkMonitor.autoConvertEnabled,
    history: converterService.getHistory()
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'launch_browser') {
        await browserController.launchBrowser();
      } else if (data.type === 'reconnect_browser') {
        await browserController.reconnectBrowser();
      } else if (data.type === 'close_browser') {
        await browserController.closeBrowser();
      } else if (data.type === 'set_autoconvert') {
        networkMonitor.setAutoConvert(data.enabled);
        broadcastWebSocket({ type: 'autoconvert_changed', enabled: data.enabled });
      } else if (data.type === 'browser_interact') {
        await browserController.handleUserInteraction(data.interaction);
      }
    } catch (err) {
      console.error('[WebSocket] Error handling client message:', err);
    }
  });
});

// REST API Endpoints

// 1. Browser Control
app.post('/api/browser/launch', async (req, res) => {
  try {
    await browserController.launchBrowser();
    res.json({ success: true, status: browserController.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/browser/reconnect', async (req, res) => {
  try {
    await browserController.reconnectBrowser();
    res.json({ success: true, status: browserController.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/browser/close', async (req, res) => {
  try {
    await browserController.closeBrowser();
    res.json({ success: true, status: browserController.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/browser/interact', async (req, res) => {
  try {
    await browserController.handleUserInteraction(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/browser/status', (req, res) => {
  res.json({ status: browserController.getStatus(), autoConvert: networkMonitor.autoConvertEnabled });
});

// 2. Conversion Settings
app.post('/api/toggle-autoconvert', (req, res) => {
  const { enabled } = req.body;
  networkMonitor.setAutoConvert(enabled);
  broadcastWebSocket({ type: 'autoconvert_changed', enabled: networkMonitor.autoConvertEnabled });
  res.json({ success: true, enabled: networkMonitor.autoConvertEnabled });
});

// 3. Manual File Upload Conversion
app.post('/api/convert/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = req.file.originalname;
    const baseName = path.parse(originalName).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const taskId = `manual_${baseName}_${Date.now().toString(36)}`;

    const glbBuffer = await converterService.processConversion(taskId, req.file.buffer, 'manual_file');

    res.json({
      success: true,
      taskId,
      filename: `${taskId}.glb`,
      sizeBytes: glbBuffer.length,
      downloadUrl: `/api/download/${taskId}`
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Manual URL Conversion (Section 18 & 27)
app.post('/api/convert/url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string' || !isMeshyModelUrl(url)) {
      return res.status(400).json({
        error: 'Invalid URL. Must match pattern: ^https://assets.meshy.ai/.../tasks/.../output/model.meshy'
      });
    }

    const taskId = extractTaskId(url);
    if (!taskId) {
      return res.status(400).json({ error: 'Could not extract Task ID from provided Meshy URL.' });
    }

    let modelBuffer = null;

    // Retrieve model using authenticated Playwright page context if available
    if (browserController.page && !browserController.page.isClosed()) {
      console.log(`[Server] Fetching model URL via Playwright browser context: ${url}`);
      const response = await browserController.page.request.get(url);
      if (!response.ok()) {
        throw new Error(`Meshy asset URL returned HTTP status ${response.status()}`);
      }
      modelBuffer = await response.body();
    } else {
      console.log(`[Server] Fetching model URL via HTTP fetch: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Meshy asset URL returned HTTP status ${response.status}`);
      }
      const arrayBuf = await response.arrayBuffer();
      modelBuffer = Buffer.from(arrayBuf);
    }

    const glbBuffer = await converterService.processConversion(taskId, modelBuffer, 'manual_url');

    res.json({
      success: true,
      taskId,
      filename: `${taskId}.glb`,
      sizeBytes: glbBuffer.length,
      downloadUrl: `/api/download/${taskId}`
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Download Endpoint (Section 19)
app.get('/api/download/:taskId', (req, res) => {
  const { taskId } = req.params;
  const glbBuffer = converterService.getConvertedBuffer(taskId);

  if (!glbBuffer) {
    return res.status(404).send('Model file not found or expired.');
  }

  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Disposition', `attachment; filename="${taskId}.glb"`);
  res.setHeader('Content-Length', glbBuffer.length);
  res.send(glbBuffer);
});

// 6. History Management
app.get('/api/history', (req, res) => {
  res.json({ history: converterService.getHistory() });
});

app.post('/api/history/clear', (req, res) => {
  converterService.clearHistory();
  res.json({ success: true });
});

app.delete('/api/history/:taskId', (req, res) => {
  converterService.removeTask(req.params.taskId);
  res.json({ success: true });
});

// Start HTTP & WebSocket Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Meshy Auto-Converter running at http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
