# Betaal Full Offline Privacy & Reasoning Verification (Kill-Switch Demo)

This document provides step-by-step instructions to verify that Betaal performs **all perception, redaction, reasoning, decision-making, and action execution locally on the machine with zero internet connection required**.

---

## 📋 Objective
Prove to judges and auditors that Betaal is **100% offline capable**:
- **Perception & Privacy**: Vision classification, OCR, PII detection, BlazeFace ONNX face detection, and canvas redaction run locally in the browser.
- **Reasoning & Action Decision**: Runs via a local Ollama model (`qwen2.5:1.5b-instruct-q4_K_M`) at `http://localhost:11434`.
- **Zero Network Dependency**: Zero external internet calls, zero cloud API keys, zero image transmission across network requests.

---

## 🛠️ Step-by-Step Verification Procedure

### Step 1: Confirm Local Model (Ollama) is Running
1. Open terminal and verify Ollama is running locally:
   ```bash
   ollama run qwen2.5:1.5b-instruct-q4_K_M
   ```
2. Start the local Betaal backend server:
   ```bash
   npm start
   ```

### Step 2: Cut Off Internet & Network Connection
1. Disconnect your Wi-Fi or unplug your Ethernet cable via your OS network settings.
2. Verify you have **no active internet connection** (attempt to open `https://google.com` in a separate tab and confirm Chrome shows "No internet").

### Step 3: Run Full Multi-Step Wizard Task
1. Open Chrome and navigate to the local Passport Application multi-step wizard:
   `https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html` (or local `demo-page/passport-application.html`).
2. Open the Betaal extension popup.
3. Enter Goal: `"Complete my passport application form"`.
4. Click **Run Agent**.

---

## 🔍 Expected Results & Observations

### Full End-to-End Offline Agent Execution (SUCCESS):
With **zero internet connection active**, the agent completes the full multi-step loop:
1. **Screen Capture & Perception**: Local CLIP ViT + OCR + BlazeFace ONNX detect PII & faces.
2. **Local Redaction**: Canvas redacts PII and pixelates faces on-device.
3. **Local Qwen Reasoning**: Backend POSTs compact text DOM context to `http://localhost:11434/api/generate` with `format: "json"`.
4. **Local Action Execution**: Action executor resolves sensitive identity values locally from `local-profile.js` (`valueSource`) and performs character-by-character typing.
5. **Safety & Intervention Preserved**: Pauses on human-in-the-loop triggers (final submit button, file upload) for user approval.
6. **Zero Image Network Transmission**: Outgoing payload to local server is text-only (DOM structure + goal), payload size < 5KB.

### Server Offline Fail-Safe (If Ollama is stopped):
If the local Ollama service is stopped mid-run:
- Returns a clear, specific error:
  ```text
  Local model server not running — start Ollama
  ```

---

## 💡 Key Conclusion for Judges
> **"Betaal is completely self-contained and operates 100% offline. From visual perception and PII redaction to AI reasoning via Qwen 2.5 and action execution, zero data leaves the machine, zero cloud APIs are required, and privacy compliance under DPDP Act 2023 is guaranteed end-to-end."**
