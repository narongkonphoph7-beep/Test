
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Modality } from "@google/genai";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3001; // Back-end port

// Increase payload limit for base64 images
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Initialize Gemini SDK on Server
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// === USAGE TRACKING ===
let dailyRequestCount = 0;
const DAILY_LIMIT = 1500; // Gemini Free Tier Limit

const logUsage = (type) => {
  dailyRequestCount++;
  console.log('------------------------------------------------');
  console.log(`⚡ Action: ${type}`);
  console.log(`📊 Session Usage: ${dailyRequestCount} / ${DAILY_LIMIT} requests`);
  
  if (dailyRequestCount >= DAILY_LIMIT) {
    console.warn('⚠️ WARNING: You are approaching the daily free tier limit!');
  }
  
  const remaining = DAILY_LIMIT - dailyRequestCount;
  console.log(`✅ Remaining: ~${remaining} requests available today`);
  console.log('------------------------------------------------');
};

// === SMART RATE LIMITER (The Speed Upgrade) ===
// Instead of blind waiting, we track the LAST call time.
// If enough time has passed, we don't wait at all!
let lastApiCallTime = 0;
const MIN_INTERVAL_MS = 4000; // 15 RPM = 1 request every 4 seconds

const smartThrottle = async () => {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < MIN_INTERVAL_MS) {
    const waitTime = MIN_INTERVAL_MS - timeSinceLastCall;
    console.log(`⏳ Throttling: Protecting quota, waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  // Update the tracker to NOW (after the wait)
  lastApiCallTime = Date.now();
};

// === QUEUE SYSTEM ===
let ttsQueue = Promise.resolve();

// === API ROUTES ===

// 1. OCR & Summary Route
app.post('/api/process-document', async (req, res) => {
  try {
    // Apply smart throttle here too for safety, but usually OCR is the first step
    // so it will likely be instant (0ms wait).
    await smartThrottle();
    
    logUsage('OCR Processing');
    const { files } = req.body; 

    const parts = [];
    parts.push({
      text: `
        Task: OCR and Summarize Thai Document.
        Instructions: 
        1. Read text from images.
        2. Summarize into a CONCISE, COHESIVE story in THAI (ภาษาไทย).
        3. IMPORTANT: Keep the summary UNDER 400 WORDS to optimize for audio generation.
        4. Tone: Natural Spoken Style (เล่าเรื่อง).
        5. Output JSON: { "originalText": "...", "summary": "..." }
      `
    });

    files.forEach(file => {
      parts.push({
        inlineData: { data: file.base64, mimeType: file.mimeType }
      });
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: parts },
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            originalText: { type: Type.STRING },
            summary: { type: Type.STRING }
          }
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Empty response from AI");
    
    const data = JSON.parse(resultText);
    res.json(data);

  } catch (error) {
    console.error("OCR Error:", error);
    res.status(500).json({ error: error.message || "OCR Processing Failed" });
  }
});

// 2. TTS Route (With Queue)
app.post('/api/generate-speech', async (req, res) => {
  const { text, voiceName } = req.body;

  // Add this request to the queue
  ttsQueue = ttsQueue.then(async () => {
    try {
      console.log(`Processing TTS... (Text length: ${text.length})`);
      
      // Smart Throttle: Only wait if we just made a request (e.g. OCR just finished)
      await smartThrottle();

      // 2. Call Gemini
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName || 'Puck' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!base64Audio) {
         throw new Error("No audio data returned");
      }

      logUsage('TTS Generation');
      res.json({ audioBase64: base64Audio });

    } catch (error) {
      console.error("TTS Generation Error:", error);
      const status = error.status || 500;
      res.status(status).json({ error: error.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend Server running on http://localhost:${PORT}`);
  console.log(`⚡ Speed Mode: Optimized (Smart Throttling)`);
});
