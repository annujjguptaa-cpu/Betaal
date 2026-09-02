# Betaal Offline Client-Side Privacy Verification (Kill-Switch Demo)

This document provides step-by-step instructions to verify that Betaal performs all sensitive detection and redaction locally on the client machine with **zero internet connection required**.

---

## 📋 Objective
Prove to judges and auditors that Betaal's vision classifier, OCR engine, PII detector, face detector, and canvas redactor execute completely offline in the browser BEFORE any network attempt is made.

---

## 🛠️ Step-by-Step Verification Procedure

### Step 1: Open the Target Page
1. Open Google Chrome.
2. Navigate to the grievance demo portal page:
   `file:///c:/Users/ASUS/OneDrive/Desktop/Betaal/demo-page/index.html`
3. Ensure the pre-filled fields (Aadhaar, Phone, Address) and the Video Verification tile are rendered on screen.

### Step 2: Cut Off Internet & Network Connection
1. Disconnect your Wi-Fi or unplug your Ethernet cable via your OS network settings.
2. Verify you have **no active internet connection** (e.g., attempt to open `https://google.com` in a separate tab and confirm Chrome shows "No internet").

### Step 3: Run Betaal Extension
1. Click the **Betaal Extension icon** in the Chrome extension toolbar.
2. Ensure **Redaction: ON** is checked.
3. Click the **Run Agent** button.

---

## 🔍 Expected Results & Observations

### Local Client-Side Execution (SUCCESS):
Even with **zero internet connection**, the extension UI will log and complete all local stages:
1. **Screen Capture**: `✅ [1/6] Screen screenshot captured`
2. **Local Vision & Redaction Pipeline**: `✅ [2/6] Privacy pipeline complete`
3. **DOM Extraction**: `✅ [3/6] DOM structure retrieved`
4. **Side-by-Side Thumbnails**:
   - `Original Screen`: Displays the raw screenshot with visible PII and webcam face.
   - `Redacted Screen (Sent)`: Displays the redacted screenshot with **blacked-out Aadhaar/phone** and **pixelated webcam face**.
5. **Detection Table**: Populates with detected regions:
   - Aadhaar Number (Redaction Method: Solid Blackfill)
   - Phone Number (Redaction Method: Solid Blackfill)
   - User Face Region (Redaction Method: Irreversible Pixelation)

### Network Call Fail-Safe (EXPECTED TIMEOUT):
When the pipeline reaches Stage 4 (Server VLM Reasoning), it attempts to send the already-redacted image to the backend server. Since the network/server is offline:
- **Status Log**: `⏳ [4/6] Sending payload to Backend VLM server...`
- **Final Result**: Displays a clean, non-crashing error box:
  ```text
  ❌ Execution Error: Failed to reach Betaal backend server at http://localhost:3000: Failed to fetch
  ```

---

## 💡 Key Conclusion for Judges
> **"The screenshot was completely captured, classified, OCR-scanned, PII-detected, face-detected, and redacted locally on the client device while offline. No image data left the machine, and privacy enforcement was 100% complete before the network call ever attempted to initiate."**
