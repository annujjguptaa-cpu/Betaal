# Betaal – Multi‑Mode Face & PII Detection Chrome Extension

## Overview
Betaal is a privacy‑preserving Chrome/Edge extension that:
- Detects faces and personally‑identifiable information (PII) on a webpage screenshot.
- Provides three **performance modes**:
  - **Fast** – uses a dynamically‑quantised ONNX model (`face_detector_fast.onnx`) and skips ViT screen classification for minimal latency.
  - **Balanced** – default mode, runs ViT classification then the balanced model (`face_detector_balanced.onnx`).
  - **Accurate** – up‑scales the screenshot 1.5× before detection to improve sensitivity on tiny text/fields.
- Allows the user to compare the three modes side‑by‑side with a live UI.
- Supports redaction of detected regions according to a configurable policy.

## Repository Structure
```
Betaal/
├─ .git/                 # Git metadata (already configured)
├─ extension/            # Core extension source
│   ├─ detection/        # Face, PII, ViT detection logic
│   │   ├─ face-detect.js   # Updated with per‑model cache & modelPath argument
│   │   ├─ pii-detector.js
│   │   ├─ vit-classifier.js
│   │   └─ ...
│   ├─ redaction/        # Redaction implementation
│   ├─ pipeline.js       # Performance‑mode aware processing pipeline
│   ├─ manifest.json
│   └─ ...
├─ scripts/                # Build‑time utilities
│   └─ quantize_model.py   # One‑time ONNX dynamic quantisation script
├─ popup.html / popup.js   # UI for mode selector, run‑agent button, comparison view
├─ docs/                   # Documentation
│   └─ architecture.md      # System architecture diagram (Mermaid)
└─ README.md               # This file
```

## Getting Started
### Prerequisites
- **Node.js** (v18+) & npm
- **Python 3.10+** (for quantisation script)
- **ONNX Runtime Web** (`npm install onnxruntime-web` – already a dependency)
- A recent Chrome/Edge browser with extension loading enabled.

### Installation
```bash
# Clone the repo (already done for you)
cd "C:\Users\ASUS\OneDrive\Desktop\Betaal"

# Install node dependencies
npm install
```

### Build the Fast Model (one‑time step)
```bash
python scripts/quantize_model.py extension/models/face_detector.onnx extension/models/face_detector_fast.onnx
```
The script copies the original model to `face_detector_balanced.onnx` (if not present) and writes a quantised version `face_detector_fast.onnx`. Sizes are logged for verification.

### Load the Extension in Chrome
1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `Betaal/extension` folder.
4. Pin the extension toolbar icon.

### Using the Extension
- Click the toolbar icon → the popup appears.
- Choose **Fast**, **Balanced**, or **Accurate** via the segmented control.
- Press **Run Agent** to capture the current tab, process it, and see redacted results.
- Press **⚡ Compare Modes** to run the same screenshot through all three modes and view a side‑by‑side comparison (latency, detection count, and redacted images).

## Development Workflow
1. **Modify code** inside `extension/`.
2. **Run the extension** via Chrome reload.
3. **Iterate** – the UI automatically reflects the selected performance mode.
4. **Commit & push** changes:
   ```bash
   git add .
   git commit -m "Your descriptive message"
   git push origin main
   ```

## Documentation
- **System Architecture** – see `docs/architecture.md`.
- **Model Variants** – see `docs/model-variants.md` (not yet created, you can extend).

## Contributing
Feel free to open issues or submit pull requests. Follow the standard GitHub flow:
1. Fork the repo.
2. Create a feature branch.
3. Commit your changes.
4. Open a PR targeting `main`.

## License
MIT – see `LICENSE` file.
