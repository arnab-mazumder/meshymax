# Meshy to GLB Auto-Converter (Chrome Extension)

**A lightweight Chrome Extension (Manifest V3) that automatically intercepts Meshy AI `.meshy` model downloads, decrypts & decompresses them into standard uncompressed `.glb` files, and triggers automatic browser downloads.**

Includes an integrated link to [iMeshh 3D Viewer](https://imeshh.com/tools/gltf-viewer) in the extension popup for instant lighting adjustments and 3D model inspection.

---

## Features

- ⚡ **Automated Network Interceptor**: Intercepts `assets.meshy.ai` network responses for `/output/model.meshy`.
- 🔓 **Clean-Room Decryption**: Decrypts AES-256-CTR `.meshy` containers on the fly using standard WebCrypto API.
- 📦 **Meshopt Decompression**: Decompresses `EXT_meshopt_compression` vertex & index buffers into standalone raw GLBs.
- 🎚️ **ON/OFF Toggle Switch**: Single slider button in the popup to pause or enable auto-conversion at any time.
- 💡 **iMeshh 3D Viewer Integration**: Direct popup link to [imeshh.com/tools/gltf-viewer](https://imeshh.com/tools/gltf-viewer) to inspect models, adjust studio lighting, shadows, and materials.

---

## Installation (Chrome / Edge / Brave / Chromium)

1. Open your browser and navigate to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (toggle switch in the top right).
3. Click **Load unpacked**.
4. Select this directory.
5. The extension is installed and ready to run! No Node.js or `npm install` needed.

---

## Usage

1. **Browse Meshy.ai**: Go to [Meshy AI](https://meshy.ai) and generate or view your 3D models.
2. **Automatic Download**: As soon as Meshy loads a `.meshy` model asset, the extension intercepts it, converts it to standard `.glb`, and downloads it to your browser downloads folder.
3. **Toggle ON / OFF**: Click the extension icon in your browser toolbar to toggle auto-conversion ON or OFF.
4. **Lighting & 3D Viewer**: Click **iMeshh 3D Viewer** in the extension popup to open [imeshh.com/tools/gltf-viewer](https://imeshh.com/tools/gltf-viewer) in a new tab to view your exported `.glb` and customize environment lighting.

---

## Extension Structure

```
manifest.json                     # Chrome MV3 manifest
background.js                    # Service worker network interceptor & downloader
lib/
  ├── converter.js               # Unified conversion pipeline
  ├── decrypt.js                 # WebCrypto AES-256-CTR container decryptor
  ├── decompress.js              # meshopt stream decompressor
  └── meshopt_decoder.module.js  # WASM decoder
popup/
  ├── popup.html                 # Extension UI with ON/OFF slider & iMeshh link
  ├── popup.css                  # Dark glassmorphic styling
  └── popup.js                   # Extension state & event handlers
icons/                           # Extension icons
```

---

## License

MIT License
