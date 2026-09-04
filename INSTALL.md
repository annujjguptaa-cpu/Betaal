# 🚀 How to Install & Run Betaal Chrome Extension

> **Quick Hackathon / Submission Setup Guide**  
> Chrome extensions do not need to be published on the Chrome Web Store to be installed. Anyone can load the source code directly in under 2 minutes!

---

## 📦 Step-by-Step Installation Instructions

### Step 1: Download or Clone the Repository
Clone the repository using Git or download it as a ZIP file and extract it on your computer:
```bash
git clone https://github.com/annujjguptaa-cpu/Betaal.git
cd Betaal
```

### Step 2: Open Chrome Extensions
1. Open Google Chrome (or Microsoft Edge / Brave).
2. Type `chrome://extensions` in the address bar and press **Enter**.

### Step 3: Enable Developer Mode
1. In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.

### Step 4: Load the Unpacked Extension
1. Click the **Load unpacked** button in the top-left corner.
2. Select the root **`Betaal`** folder (which contains `manifest.json`).

### Step 5: Start the Backend Server (Local VLM Engine)
Open your terminal in the `Betaal` project directory and run:
```bash
npm install
npm start
```

---

## 📝 How to Use Betaal to Fill Forms & Automate Web Pages

### Can Betaal fill out a form for you?
**YES!** Betaal is designed to take natural language goals, inspect the page visually (with privacy redaction applied), reason using a Vision-Language Model, and automatically click buttons, select fields, or type text into forms.

### Where do you type your instructions?
1. Navigate to any form or webpage in Google Chrome (e.g. the demo page at `file:///YOUR_PATH/Betaal/demo-page/index.html` or a live form).
2. Click the **Betaal extension icon** (बेताल) in your Chrome toolbar.
3. In the popup under the **Live View** tab, you will see a text input labeled:  
   👉 **`What should I help you do on this page?`**
4. Type your prompt or request (for example):
   - `"Fill out this grievance form with test data and submit"`
   - `"Enter my name and phone number in the contact fields"`
   - `"Click the next button to proceed"`
5. Click **Run Agent**.

Betaal will capture the screen, locally redact any sensitive PII (Aadhaar, PAN, phone numbers, faces) so your real data never leaks to the cloud, send the sanitized view to the VLM backend, and execute the form-filling steps automatically!
