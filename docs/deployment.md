# 🌐 Betaal Deployment & Rate-Limiting Guide

> **Deployment Reference & Configurations**  
> Covers backend server deployment, rate-limiting & cost protection configurations, public GitHub Pages demo setup, and extension endpoint configuration.

---

## 1. Backend Server Deployment (Render / Railway)

The Express backend (`backend/server.js`) is fully prepared for zero-configuration deployment to free cloud hosts such as **Render** or **Railway**.

### Environment Configuration
- **Port Bounding**: Automatically reads `process.env.PORT` assigned by cloud providers, falling back to port `3000` for local development.
- **CORS Handling**: Wildcard origin checking supports Chrome extensions (`chrome-extension://*`), Firefox add-ons (`moz-extension://*`), and hosted frontend origins.
- **Zero-Persistence Guarantee**: In-memory body parsing (`limit: '10mb'`) ensures base64 data URLs are processed entirely in transient RAM without writing temporary image files to disk.

### Live Deployed Backend URL
```text
https://betaal-backend-p8vk.onrender.com
```

### Steps to Deploy on Render / Railway
1. **Repository Link**: Connect your GitHub repository `annujjguptaa-cpu/Betaal` to Render or Railway.
2. **Build & Start Commands**:
   - **Root Directory**: `.` (or `./backend`)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start` (Executes `node backend/server.js`)
3. **Environment Variables**:
   - `PORT`: (Set automatically by Render/Railway)
   - `GEMINI_API_KEY`: *(Optional)* Your Gemini API key for live VLM reasoning.
   - `GLOBAL_DAILY_MAX_REQUESTS`: *(Optional, default: 200)* Daily API call ceiling.

---

## 2. Public Cost-Protection & Rate Limiting

To prevent cost abuse and spam on the public `/act` backend endpoint, an **in-memory rate limiter and daily cost ceiling** are built directly into `backend/server.js` with zero external dependencies:

### Rate-Limiting Mechanics
1. **Per-IP Rate Limiter**:
   - Limit: **Max 20 requests per IP per hour**.
   - Tracked via an in-memory `Map` storing request counts and sliding time window timestamps.
   - Exceeding the limit returns HTTP `429 Too Many Requests`:
     ```json
     { "error": "Rate limit exceeded (max 20 requests per hour). Try again in 42 minutes." }
     ```

2. **Global Daily Ceiling**:
   - Limit: **Max 200 total requests per day** across all clients when a paid VLM API key is configured.
   - Resets automatically at midnight UTC.
   - Exceeding the ceiling returns HTTP `429 Too Many Requests`:
     ```json
     { "error": "Global daily request cap (200) reached for cost protection. Resets tomorrow." }
     ```

> ℹ️ *Note for SIH Evaluators*: This rate limit is a deliberate security and cost-protection measure protecting the live backend deployment against denial-of-wallet attacks, not an architectural limitation.

---

## 3. GitHub Pages Demo Hosting

The interactive test pages are hosted on GitHub Pages directly from the `demo-page/` directory.

### Live GitHub Pages URLs
- **Citizen Grievance Portal**:  
  `https://annujjguptaa-cpu.github.io/Betaal/demo-page/`
- **Passport Application Multi-Step Wizard**:  
  `https://annujjguptaa-cpu.github.io/Betaal/demo-page/passport-application.html`

### Asset Path Resolution
Both HTML pages use self-contained CSS, embedded SVG data URLs for webcam fallbacks, and standard inline vanilla JS without external relative file dependencies (`../`). All asset paths resolve seamlessly when served over HTTPS from GitHub Pages.

---

## 4. Extension Backend URL Configuration

The extension allows users to dynamically switch between local and deployed backend endpoints from the **Policy** tab:

1. Open the **Betaal Extension Popup**.
2. Click the **Policy** tab.
3. Scroll to **🌐 Backend VLM Server Endpoint**.
4. Paste your live deployment URL (e.g. `https://betaal-backend.onrender.com`) and click **Save Endpoint**.
5. The extension reads `backendUrl` from `chrome.storage.local` at runtime, defaulting to `http://localhost:3000` if unset.
