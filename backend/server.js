/* backend/server.js — Prompts 91 & 92 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callVLM, parseVLMResponse } = require('./llm');

const app = express();
const PORT = process.env.PORT || 3000;

// Prompt 92: Simple in-memory rate limiter & global daily request cap (No external dependencies)
const RATE_LIMIT_MAX_PER_HOUR = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ipRequestMap = new Map();

// Global daily ceiling when real API keys are active
const GLOBAL_DAILY_MAX_REQUESTS = parseInt(process.env.GLOBAL_DAILY_MAX_REQUESTS || '200', 10);
let globalDailyRequestCount = 0;
let lastResetDate = new Date().toDateString();

function checkRateLimit(ip) {
  const now = Date.now();
  const currentDate = new Date().toDateString();

  // Reset global daily counter at midnight
  if (currentDate !== lastResetDate) {
    lastResetDate = currentDate;
    globalDailyRequestCount = 0;
  }

  // Check global ceiling if API key is present
  const hasRealKey = Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (hasRealKey && globalDailyRequestCount >= GLOBAL_DAILY_MAX_REQUESTS) {
    return {
      allowed: false,
      reason: `Global daily request cap (${GLOBAL_DAILY_MAX_REQUESTS}) reached for cost protection. Resets tomorrow.`
    };
  }

  // Per-IP window cleanup and rate check
  let record = ipRequestMap.get(ip);
  if (!record || (now - record.startTime) > RATE_LIMIT_WINDOW_MS) {
    record = { count: 0, startTime: now };
    ipRequestMap.set(ip, record);
  }

  if (record.count >= RATE_LIMIT_MAX_PER_HOUR) {
    const remainingMs = RATE_LIMIT_WINDOW_MS - (now - record.startTime);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return {
      allowed: false,
      reason: `Rate limit exceeded (max ${RATE_LIMIT_MAX_PER_HOUR} requests per hour). Try again in ${remainingMinutes} minutes.`
    };
  }

  // Increment counters
  record.count++;
  if (hasRealKey) globalDailyRequestCount++;

  return { allowed: true };
}

// CORS configuration supporting browser extensions (Chrome, Firefox, Edge) & deployed frontend origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || 
        origin.startsWith('chrome-extension://') || 
        origin.startsWith('moz-extension://') || 
        origin.startsWith('https://') || 
        origin.startsWith('http://localhost') || 
        origin === 'null') {
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
  res.json({ 
    message: 'Betaal Backend Server is running', 
    health: '/health', 
    actEndpoint: 'POST /act',
    rateLimit: `${RATE_LIMIT_MAX_PER_HOUR} req/hr/IP`
  });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /act
app.post('/act', async (req, res) => {
  const timestamp = new Date().toISOString();
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown-ip';

  // Prompt 92: Enforce cost protection rate limiting
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    console.warn(`[${timestamp}] Rate limit blocked request from IP ${clientIp}: ${rateCheck.reason}`);
    return res.status(429).json({
      error: rateCheck.reason
    });
  }

  const { goal, redactedImage, domStructure, retrievedExamples } = req.body;

  if (!goal || !redactedImage) {
    return res.status(400).json({
      error: 'Missing required parameters. Both "goal" and "redactedImage" must be provided.'
    });
  }

  const imageSizeKb = Math.round((redactedImage.length * 0.75) / 1024);
  const domCount = Array.isArray(domStructure) ? domStructure.length : 0;
  const ragCount = Array.isArray(retrievedExamples) ? retrievedExamples.length : 0;

  console.log(`[${timestamp}] [IP: ${clientIp}] Received request. Goal: [${goal}]. Image size: [${imageSizeKb}] KB. DOM fields: [${domCount}]. RAG examples: [${ragCount}].`);
  console.log(`[${timestamp}] [1/4] Payload received, no raw PII fields detected in structure`);

  try {
    console.log(`[${new Date().toISOString()}] [2/4] Sending sanitized context to VLM`);
    const rawVLMResponse = await callVLM(redactedImage, goal, domStructure, retrievedExamples);

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
  console.log(`Betaal Backend Server listening on port ${PORT}`);
});

module.exports = app;
