# Betaal SIH Live Presentation Demo Script

**Total Duration:** 2 minutes 45 seconds  
**Presenter:** Single or Pair Presenters  

---

## 🎬 Presentation Outline & Timeline

| Time | Stage | Action / Speech |
|---|---|---|
| **0:00 - 0:20** | **1. Hook & Intro** | *"Respected judges, current AI web agents read screen content to help users, but they leak unredacted Aadhaar numbers, phone numbers, and facial webcam feeds to third-party cloud LLMs. We built **Betaal**: a privacy-preserving browser agent that redacts all PII and faces locally in the browser BEFORE anything touches the network."* |
| **0:20 - 0:45** | **2. Scenario & Demo Page** | *"Here is our demo page — an Indian Government Citizen Grievance Portal with pre-filled sensitive data (Aadhaar, Phone, Address) and a live video verification webcam feed."* |
| **0:45 - 1:15** | **3. Live Execution & Popup Debug Panel** | Open Chrome DevTools Network Tab. Open Betaal Popup (Redaction: ON) and click **Run Agent**.<br>*"As soon as we click Run Agent, Betaal executes local ViT classification, Tesseract OCR, regex PII detection, BlazeFace detection, and canvas redaction in under 500 milliseconds."* Point to side-by-side thumbnails and detection table. |
| **1:15 - 1:40** | **4. DevTools & Backend Audit** | Inspect the active `/act` HTTP POST payload in DevTools Network tab.<br>*"Notice the outgoing payload: the Aadhaar number is a solid black block, and the webcam face is block-pixelated. Now look at our backend terminal logs: `[1/4] Payload received, no raw PII fields detected`."* |
| **1:40 - 2:10** | **5. Action Execution on Page** | Watch the live webpage.<br>*"The cloud VLM reasoned over the sanitized screen, decided to click the Submit Grievance button, and returned the CSS selector. Betaal highlights the button in red and executes the action on the real page!"* |
| **2:10 - 2:35** | **6. Redaction OFF Contrast Test** | Toggle **Redaction: OFF** in popup, run again.<br>*"For contrast, if we toggle Redaction OFF, the warning banner turns red. The outgoing payload now shows raw data — proving that Betaal's redaction engine was what protected the user."* |
| **2:35 - 2:45** | **7. Closing Line** | *"Betaal sees everything locally, but reveals only what matters to the cloud. Thank you!"* |

---

## 🛡️ Backup & Fallback Plan
If the live network or laptop screen output experiences unexpected delays during the hackathon judging stage:
- **Fallback Asset**: Play pre-recorded HD video `docs/artifacts/demo-video-backup.mp4` showing the complete 6-stage execution loop with audio narration.
