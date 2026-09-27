# 🎬 Betaal — SIH Live Presentation & Video Script

**Video Title:** *Betaal — Privacy-Preserving, Fully On-Device Vision Agent for Browsers*  
**YouTube Link:** [https://youtu.be/PF9yXVGR87Q](https://youtu.be/PF9yXVGR87Q)  
**Problem Statement ID:** **SIH26171** (*On-device Visual Perception for Light-weight Browser Agents*)  
**Team ID:** **128243**  
**Total Video Duration:** 2 minutes 45 seconds  
**Presenter:** Anuj Gupta & Team 128243  

---

## 🎥 Video & Live Demonstration Timeline

| Timestamp | Presentation Stage | Speech & Visual Action | Key Technical Highlights |
| :--- | :--- | :--- | :--- |
| **0:00 - 0:20** | **1. Hook & Introduction** | *"Respected judges, current AI web agents read full screen pixels to navigate, leaking unredacted Aadhaar numbers, PAN details, phone numbers, and live webcam feeds to cloud servers. We built **Betaal**: a client-side vision agent that redacts all PII and biometrics locally in the browser BEFORE anything touches the network."* | DPDP Act 2023 alignment, Zero-Trust Architecture |
| **0:20 - 0:45** | **2. Demo Scenario Setup** | *"Here is our demo page — a Citizen Grievance & Service Portal featuring pre-filled sensitive fields (Aadhaar, Phone, Address, DOB) alongside an active webcam video feed."* | Multi-field DOM structure + live webcam tile |
| **0:45 - 1:15** | **3. On-Device Perception & Redaction** | Open Chrome DevTools & Betaal Extension Popup.<br>*"When we click **Run Agent**, Betaal executes local BlazeFace ONNX face detection, Tesseract OCR, regex PII detection, and canvas redaction on-device in under 500ms."* Show side-by-side original vs redacted thumbnails. | BlazeFace ONNX (WebGPU/WASM), Canvas 2D Blackfill & Pixelation |
| **1:15 - 1:40** | **4. DevTools Payload & Privacy Audit** | Inspect outgoing `/act` POST payload in DevTools Network tab.<br>*"Notice the outgoing payload: text PII fields are solid black blocks, and the webcam face is block-pixelated. Our backend server log confirms zero raw PII or face biometrics were received."* | `valueSource` key resolution, Zero PII transmission |
| **1:40 - 2:10** | **5. Autonomous Action Execution** | Observe live browser window execution.<br>*"The local model reasoned over the anonymized DOM structure, identified the target form field, and returned the action. Betaal highlights the field with an animated cursor and executes the action on the live webpage!"* | Local Qwen 2.5 1.5B reasoning via Ollama, Selector pre-validation |
| **2:10 - 2:35** | **6. Policy Toggle & Contrast Test** | Toggle **Redaction: OFF** in Policy Book to demonstrate contrast.<br>*"For verification, when Redaction is toggled OFF, the badge turns red and unredacted values are flagged, proving that Betaal's local redaction engine was what actively protected the user."* | Runtime-editable Policy Book & per-site rules |
| **2:35 - 2:45** | **7. Closing Remarks & Value Proposition** | *"Betaal sees everything locally, but reveals only what matters to the cloud. Thank you!"* | Team 128243, SIH26171 |

---

## 🛡️ Live Verification & Offline Kill-Switch Steps

1. **Adversarial PII Test**:
   - Type a custom Aadhaar or Phone number into any input field on the page.
   - Run Betaal — verify that solid blackfill covers the typed text *before* the network POST request fires.

2. **Offline Local Reasoning Test**:
   - Disconnect internet access.
   - Run Betaal — verify that visual perception (BlazeFace + PII detector), canvas redaction, and local Qwen 2.5 LLM reasoning (`http://localhost:11434`) continue executing 100% offline.

---

## 🔗 Project & Video Links
- **YouTube Demonstration Video**: [https://youtu.be/PF9yXVGR87Q](https://youtu.be/PF9yXVGR87Q)
- **GitHub Repository**: [https://github.com/annujjguptaa-cpu/Betaal](https://github.com/annujjguptaa-cpu/Betaal)
- **Live Demo Grievance Portal**: [https://annujjguptaa-cpu.github.io/Betaal/demo-page/](https://annujjguptaa-cpu.github.io/Betaal/demo-page/)
