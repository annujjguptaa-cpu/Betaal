# 🎬 Betaal — SIH Presentation & Demonstration Video Script

**Video Title:** *Betaal — Privacy-Preserving, Fully On-Device Vision Agent for Browsers*  
**YouTube Link:** [https://youtu.be/PF9yXVGR87Q](https://youtu.be/PF9yXVGR87Q)  
**Problem Statement ID:** **SIH26171** (*On-device Visual Perception for Light-weight Browser Agents*)  
**Team ID:** **128243**  
**Total Video Duration:** 2 minutes 45 seconds  
**Presenter:** Anuj Gupta & Team 128243  

---

## 🎥 Video Timeline & Presentation Narrative Script

### Stage 1: Hook & Core Problem (0:00 - 0:20)
* **Visual Action:** Presenter introduces the problem on screen, highlighting the risks of existing cloud-based AI browser agents.
* **Narrative Script:**
  > *"Respected judges, current AI web agents read full-screen pixels to navigate web portals. In doing so, they leak unredacted Aadhaar numbers, PAN details, phone numbers, and live webcam feeds directly to third-party cloud LLM servers. Under India's **DPDP Act 2023**, this data exposure is unacceptable for sensitive government and citizen services.*
  > 
  > *To solve this, we built **Betaal**: a privacy-preserving, client-side vision agent that detects and redacts all PII and facial biometrics locally inside the browser BEFORE any payload crosses the network."*
* **Key Technical Highlights:** DPDP Act 2023 compliance, Zero-Trust client-side architecture.

---

### Stage 2: Demo Portal Setup & Pre-filled PII (0:20 - 0:45)
* **Visual Action:** Open the Citizen Grievance & Service Portal demo page featuring pre-filled identity fields (Aadhaar, Phone, DOB, Address) and a live webcam tile.
* **Narrative Script:**
  > *"Here is our demo environment — an Indian Citizen Grievance Portal populated with sensitive identity fields such as Aadhaar, Mobile Number, Date of Birth, and a live webcam video feed.*
  > 
  > *When a standard AI agent captures this screen, all raw identity data and facial biometrics are transmitted unredacted to external APIs. Now let's see how Betaal protects the user."*
* **Key Technical Highlights:** Multi-field DOM structure, shadow DOM traversal, live webcam tile.

---

### Stage 3: Local Perception, Detection & Redaction (0:45 - 1:15)
* **Visual Action:** Open the Betaal extension popup, select **Balanced Mode**, and click **Run Agent**. The DevTools panel and popup telemetry feed highlight real-time execution.
* **Narrative Script:**
  > *"As soon as we click **Run Agent**, Betaal launches its on-device perception pipeline:*
  > 1. *MobileNet / ViT classifies the screen structure.*
  > 2. *Local regex pattern matching and Tesseract OCR scan for sensitive identity text.*
  > 3. *BlazeFace ONNX executes hardware-accelerated face detection via WebGPU/WASM.*
  > 4. *The HTML5 Canvas redactor applies solid blackfill over text PII and block-pixelates the facial region.*
  > 
  > *All of this processing completes in under 500 milliseconds, entirely inside the browser worker thread."*
* **Key Technical Highlights:** BlazeFace ONNX, MobileNet/ViT classifier, HTML5 Canvas 2D blackfill & pixelation.

---

### Stage 4: DevTools Audit & Zero-PII Payload Verification (1:15 - 1:40)
* **Visual Action:** Inspect the outgoing `/act` HTTP POST request in Chrome DevTools Network tab and backend terminal output.
* **Narrative Script:**
  > *"Let's verify what actually left the machine by inspecting the Chrome DevTools Network tab.*
  > 
  > *Notice the outgoing payload: text PII regions are completely blacked out, and the webcam face is permanently pixelated. Furthermore, sensitive input values use local `valueSource` key aliases rather than raw values.*
  > 
  > *Looking at our local Express backend logs: `[1/4] Payload received, zero PII or face biometrics detected`. We have mathematically guaranteed zero data leakage to the server."*
* **Key Technical Highlights:** `valueSource` key resolution, Zero PII transmission, backend server audit logs.

---

### Stage 5: Local LLM Reasoning & Page Execution (1:40 - 2:10)
* **Visual Action:** Show the agent loop executing on the live page, displaying the Set-of-Marks overlay and animated cursor moving to the target element.
* **Narrative Script:**
  > *"Our local Ollama model (`qwen2.5:1.5b-instruct-q4_K_M`) receives only the anonymized DOM structure and user goal. It reasons over the sanitized elements and returns the structured action JSON.*
  > 
  > *Betaal validates that the chosen element selector exists in the live DOM, draws a green Set-of-Marks bounding box, glides an animated cursor to the target, and fills the form field locally from `chrome.storage.local`."*
* **Key Technical Highlights:** Local Ollama Qwen 2.5 1.5B reasoning (`localhost:11434`), selector pre-validation, Set-of-Marks overlay.

---

### Stage 6: Policy Book & Redaction Toggle Verification (2:10 - 2:35)
* **Visual Action:** Open the **Policy** tab in the extension popup and toggle **Redaction: OFF** to demonstrate contrast.
* **Narrative Script:**
  > *"Betaal gives users total governance over their data through the **Policy Book**. Users can toggle specific PII rules, change face detection modes, or set per-site overrides.*
  > 
  > *For contrast, if we toggle Redaction OFF, the status badge turns red and unredacted values are flagged. This proves that Betaal's local redaction engine was what actively protected the citizen's data during execution."*
* **Key Technical Highlights:** Runtime-editable Policy Book (`policy-book.js`), per-site rule overrides.

---

### Stage 7: Summary & Conclusion (2:35 - 2:45)
* **Visual Action:** Show the extension completing the multi-step flow with full telemetry telemetry summary.
* **Narrative Script:**
  > *"To summarize: Betaal delivers a 100% private, on-device AI web agent that is fully compliant with India's DPDP Act 2023. It sees everything locally on your device, but reveals only what matters to the cloud.*
  > 
  > *Thank you! (Team 128243 — Problem Statement SIH26171)"*
* **Key Technical Highlights:** Team 128243, SIH26171 presentation conclusion.

---

## 🛡️ Presentation Quick Reference Table

| Timestamp | Stage Name | Visual Action | Key Script / Narrative Point |
| :--- | :--- | :--- | :--- |
| **0:00 - 0:20** | Hook & Introduction | Presenter introducing Betaal | Local PII & face redaction BEFORE network transmission (DPDP Act 2023). |
| **0:20 - 0:45** | Scenario Setup | Citizen Grievance Portal | Pre-filled Aadhaar, Phone, DOB, Address & live webcam tile. |
| **0:45 - 1:15** | Perception & Redaction | Popup **Run Agent** & DevTools | BlazeFace ONNX + OCR + Canvas blackfill & pixelation in <500ms. |
| **1:15 - 1:40** | DevTools Audit | `/act` POST request inspection | Solid blackfill on image, `valueSource` aliases, 0 PII in server log. |
| **1:40 - 2:10** | Action Execution | Live page execution | Qwen 2.5 local LLM reasoning, Set-of-Marks overlay, cursor animation. |
| **2:10 - 2:35** | Policy Toggle Test | Policy Book tab toggle | Toggle Redaction OFF to show red badge warning and contrast. |
| **2:35 - 2:45** | Conclusion | Summary telemetry view | *"Sees everything locally, reveals only what matters to the cloud."* |

---

## 🔗 Demonstration & Repository Links
- **YouTube Demonstration Video**: [https://youtu.be/PF9yXVGR87Q](https://youtu.be/PF9yXVGR87Q)
- **GitHub Repository**: [https://github.com/annujjguptaa-cpu/Betaal](https://github.com/annujjguptaa-cpu/Betaal)
- **Live Demo Grievance Portal**: [https://annujjguptaa-cpu.github.io/Betaal/demo-page/](https://annujjguptaa-cpu.github.io/Betaal/demo-page/)
- **Live Demo Passport Wizard**: [https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html](https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html)
