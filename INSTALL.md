# 🚀 How to Install & Run Betaal Chrome Extension

> **Quick Hackathon / Submission Setup Guide**  
> Chrome extensions do not need to be published on the Chrome Web Store to be installed. Anyone can load the source code directly in under 2 minutes!

---

## 📦 Step-by-Step Installation Instructions

### Step 1: Install Ollama & Pull the Local Reasoning Model
Betaal's AI reasoning runs 100% locally on-device. No API keys or cloud subscriptions are required.
1. Download and install Ollama from [`https://ollama.com`](https://ollama.com).
2. Open your terminal and pull the Qwen 2.5 local model:
   ```bash
   ollama pull qwen2.5:1.5b-instruct-q4_K_M
   ```

### Step 2: Download or Clone the Repository
Clone the repository using Git or download it as a ZIP file and extract it on your computer:
```bash
git clone https://github.com/annujjguptaa-cpu/Betaal.git
cd Betaal
```

### Step 3: Open Chrome Extensions
1. Open Google Chrome (or Microsoft Edge / Brave).
2. Type `chrome://extensions` in the address bar and press **Enter**.

### Step 4: Enable Developer Mode
1. In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.

### Step 5: Load the Unpacked Extension
1. Click the **Load unpacked** button in the top-left corner.
2. Select the root **`Betaal`** folder (which contains `manifest.json`).

### Step 6: Start the Backend Server (Local Ollama Gateway)
Open your terminal in the `Betaal` project directory and run:
```bash
npm install
npm start
```

---

## 📝 How to Use Betaal to Fill Forms & Automate Web Pages

### Can Betaal fill out a form for you?
**YES!** Betaal is designed to take natural language goals, inspect the page visually (with privacy redaction applied on-device), reason using a local AI model (Qwen 2.5 1.5B via Ollama), and automatically click buttons, select fields, or type text into forms.

### Where do you type your instructions?
1. Navigate to any form or webpage in Google Chrome (e.g. the demo page at `https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html` or a live form).
2. Click the **Betaal extension icon** (बेताल) in your Chrome toolbar.
3. In the popup under the **Live View** tab, you will see a text input labeled:  
   👉 **`What should I help you do on this page?`**
4. Type your task instruction or goal (for example):
   - `"Fill out this grievance form with test data and submit"`
   - `"Complete my passport application form"`
   - `"Track the delivery status of my parcel on India Post with consignment Id: EY567991513IN"`
5. Click **Run Agent**.

Betaal will capture the screen, locally redact any sensitive PII (Aadhaar, PAN, phone numbers, faces) so your real data never leaves the machine, send the anonymized DOM structure to the local Ollama model server (`http://localhost:11434`), and execute the form-filling steps automatically with zero cloud API dependency!
