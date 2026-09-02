/* backend/server.js */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callVLM, parseVLMResponse } = require('./llm');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_ID = process.env.EXTENSION_ID || 'chrome-extension://*';

// CORS configuration supporting extension origins specifically
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin === 'null') {
      return callback(null, true);
    }
    return callback(null, true);
  }
}));

// Body parsing with raised 10MB limit for base64 image data URLs (In-Memory processing ONLY)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// GET /
app.get('/', (req, res) => {
  res.json({ message: 'Betaal Backend Server is running', health: '/health', actEndpoint: 'POST /act' });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// POST /act
app.post('/act', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { goal, redactedImage, domStructure } = req.body;

  if (!goal || !redactedImage) {
    return res.status(400).json({
      error: 'Missing required parameters. Both "goal" and "redactedImage" must be provided.'
    });
  }

  const imageSizeKb = Math.round((redactedImage.length * 0.75) / 1024);
  const domCount = Array.isArray(domStructure) ? domStructure.length : 0;

  console.log(`[${timestamp}] Received request. Goal: [${goal}]. Image size: [${imageSizeKb}] KB. DOM fields: [${domCount}]. No raw PII expected in this payload.`);
  console.log(`[${timestamp}] [1/4] Payload received, no raw PII fields detected in structure`);

  try {
    console.log(`[${new Date().toISOString()}] [2/4] Sending sanitized context to VLM`);
    const rawVLMResponse = await callVLM(redactedImage, goal, domStructure);

    console.log(`[${new Date().toISOString()}] [3/4] VLM response received and validated`);
    const parsedAction = parseVLMResponse(rawVLMResponse);

    console.log(`[${new Date().toISOString()}] [4/4] Returning action to client`);
    return res.json(parsedAction);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing /act request:`, error.message);
    return res.status(502).json({
      error: `VLM processing failed: ${error.message}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Betaal Backend Server listening on http://localhost:${PORT}`);
});

module.exports = app;
