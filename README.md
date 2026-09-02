# 🛡️ Betaal (बेताल) — Client-Side Privacy-Preserving Browser AI Agent

> **"Sees Everything. Reveals Only What Matters."**  
> *Built for Smart India Hackathon (SIH)*

Betaal is a Manifest V3 Chrome Extension that enables cloud Vision-Language Models (VLMs) to reason over and automate web interactions without ever exposing Personally Identifiable Information (PII) or user biometrics to cloud servers.

---

## 🏗️ Core Architectural Principle

```
[ Active Webpage Screen ]
         │
         ▼ (Client-Side Only in Browser)
┌─────────────────────────────────────────────────────────────┐
│ 1. ViT Vision Screen Classification                        │
│ 2. Tesseract.js OCR Text Region Extraction                   │
│ 3. Regex & Keyword PII Classification (Aadhaar, Phone, PAN) │
│ 4. BlazeFace WebGPU Face Region Detection                   │
│ 5. Canvas Redaction (Solid Blackfill PII + Block Pixelation)│
└─────────────────────────────────────────────────────────────┘
         │
         ▼ (ONLY Sanitized / Redacted Data Sent Out)
┌─────────────────────────────────────────────────────────────┐
│ 6. Express Backend & VLM Reasoning (Gemini / Claude)        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Executed Action on Real Webpage (Click / Scroll / Type)  │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

- 🔒 **Zero-Trust Client-Side Redaction**: Detection and redaction run 100% locally inside the browser with WebGPU/WASM. No image leaves the machine until all PII and faces are obfuscated.
- 🆔 **Indian PII Pattern Detection**: Custom regex engines for 12-digit Aadhaar numbers, Indian +91 phone numbers, PAN cards, email addresses, and address strings.
- 👤 **Face Obfuscation**: BlazeFace ONNX face detector applied to webcam tiles/video verification streams with non-reversible pixelation.
- 🧠 **VLM Web Automation**: Sends sanitized screens + DOM element structures to Cloud VLMs (Gemini/Claude) which return exact CSS selector actions (`click`, `scroll`, `type`).
- ⏱️ **Real-Time Performance Telemetry**: Live performance breakdown counter in popup showing capture, classification, detection, redaction, and network timing.
- 🔄 **Redaction Toggle for Comparison**: Demo toggle allowing side-by-side comparison of redacted vs unredacted payloads.

---

## 📁 Repository Structure

```text
Betaal/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background.js              # Service Worker for screenshot capture
├── content.js                 # Content script for DOM extraction & action execution
├── popup.html / popup.js      # Extension Popup UI with debug panel & timer
├── extension/
│   ├── pipeline.js            # Orchestrates classification, detection, and redaction
│   ├── network.js             # API layer connecting extension to backend
│   ├── action-executor.js     # Executes click, scroll, and type on DOM elements
│   ├── detection/
│   │   ├── ocr.js             # Tesseract.js OCR wrapper
│   │   ├── pii-patterns.js    # Regex pattern definitions (Aadhaar, Phone, PAN, Email)
│   │   ├── pii-detector.js    # Combined PII detector engine
│   │   ├── vit-classifier.js  # ViT ONNX screen classifier with WebGPU/WASM fallback
│   │   └── face-detect.js     # BlazeFace ONNX detector with Non-Max Suppression (NMS)
│   └── redaction/
│       └── redact.js          # Canvas 2D engine for black-fill & block pixelation
├── backend/
│   ├── server.js              # Express server with CORS & zero-persistence memory pipeline
│   ├── llm.js                 # VLM API caller & JSON response parser
│   └── llm-prompt.js          # Privacy-aware VLM prompt generator
├── demo-page/
│   └── index.html             # Mock Indian Government Citizen Grievance Portal & Webcam tile
├── docs/
│   ├── demo-script.md         # Timed presentation script for hackathon judges
│   └── kill-switch-demo.md    # Offline client-side verification steps
├── test-ocr.html              # Standalone browser test suite
└── package.json
```

---

## 🚀 Getting Started

### 1. Installation

Clone the repository and install dependencies:
```bash
git clone https://github.com/annujjguptaa-cpu/Betaal.git
cd Betaal
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn ON **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `Betaal` project directory.

### 4. Run the Backend Server

```bash
npm start
```

### 5. Open the Demo Page & Run Betaal

1. In Chrome, open `file:///YOUR_PATH/Betaal/demo-page/index.html`.
2. Click the **Betaal** extension icon in your toolbar.
3. Click **Run Agent**.

---

## 📄 License
ISC License
