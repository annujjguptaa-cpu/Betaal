# 🌐 Betaal Deployed Environments & Demo Test Sites

> **Live Production Server Gateway**: [`https://betaal-backend-p8vk.onrender.com`](https://betaal-backend-p8vk.onrender.com)  
> **GitHub Pages Hosted Demo Site**: [`https://annujjguptaa-cpu.github.io/Betaal/demo-page/`](https://annujjguptaa-cpu.github.io/Betaal/demo-page/)

---

## ☁️ 1. Deployed Backend Server Infrastructure

Betaal's production backend is deployed as a zero-persistence API gateway on Render:
* **Production Endpoint**: `https://betaal-backend-p8vk.onrender.com`
* **Health Check Endpoint**: `https://betaal-backend-p8vk.onrender.com/health`
* **Action Endpoint**: `POST https://betaal-backend-p8vk.onrender.com/act`
* **Architecture**: Express.js server running in transient memory mode. Features 20 req/hr/IP rate limiting, CORS configuration, multi-key pool rotation (Gemini 2.5/2.0/1.5 Flash & Claude 3.5 Sonnet), and local DOM-aware fallback decision engine when no API keys are present.

### How to Configure Betaal Extension to Use Cloud Backend:
1. Open the Betaal Extension Popup in your browser.
2. Navigate to the **Policy (⚙️)** tab.
3. In the **Backend Server URL** input field, enter: `https://betaal-backend-p8vk.onrender.com`
4. Click **Save Settings**. (The extension will now route sanitized VLM calls directly to the cloud production server).

---

## 🌐 2. Deployed Demo Sites & Execution Guide

For testing and judging evaluation, Betaal ships with two fully deployed interactive demo portals hosted on GitHub Pages.

### Demo Site 1: Citizen Grievance Portal (Single-Page Form + Video Tile)
* **Live Deployed URL**: [`https://annujjguptaa-cpu.github.io/Betaal/demo-page/`](https://annujjguptaa-cpu.github.io/Betaal/demo-page/)
* **Features**: Form text inputs (`#citizen-name`, `#aadhaar-input`, `#phone-input`), interactive grievance text area, submit buttons, and an HTML5 video element for testing BlazeFace face detection redaction.
* **Recommended Test Goal**:
  ```text
  Fill out the citizen grievance form on this page using my saved profile details and submit
  ```

### Demo Site 2: Passport Application Wizard (Multi-Step Wizard)
* **Live Deployed URL**: [`https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html`](https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html)
* **Features**: Multi-step application wizard (Step 1: Applicant Details $\rightarrow$ Step 2: Address $\rightarrow$ Step 3: Emergency Contact $\rightarrow$ Step 4: Final Review & Submit). Tests cross-page task checklist memory and `valueSource` profile resolution.
* **Recommended Test Goal**:
  ```text
  Complete the multi-step passport application wizard using my profile details
  ```

---

## 🚀 Step-by-Step Instructions to Run a Live Demo

1. **Load Betaal Extension**: Open `chrome://extensions` $\rightarrow$ Enable **Developer Mode** $\rightarrow$ Click **Load unpacked** $\rightarrow$ Select your local `Betaal` project folder.
2. **Setup Local Profile**: Open the Betaal extension popup $\rightarrow$ Go to **Profile (👤)** tab $\rightarrow$ Enter sample user details (Full Name, Email, Phone, Aadhaar, Address) $\rightarrow$ Click **Save Profile**.
3. **Open Live Demo Site**: Open either [`https://annujjguptaa-cpu.github.io/Betaal/demo-page/`](https://annujjguptaa-cpu.github.io/Betaal/demo-page/) or [`https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html`](https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html).
4. **Run Agent**: Open the Betaal extension popup in **Live View (🖥️)** tab $\rightarrow$ Type your goal $\rightarrow$ Select `Balanced` or `Fast` Performance Mode $\rightarrow$ Click **Run Agent**.
5. **Observe Execution**:
   - Numbered **Set-of-Marks (SoM) bounding boxes** highlight DOM elements.
   - The green box highlights the target element chosen by the agent.
   - The animated **Agent Cursor** glides across the webpage to target inputs.
   - Raw PII values are typed locally from `chrome.storage.local` while thumbnails in the extension popup display solid blackfill and pixelated face masks.
