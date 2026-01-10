
import { GoogleGenAI, Type } from "@google/genai";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
    // Attempt to maximize duration, though Vercel Hobby is capped at 10s
    maxDuration: 60, 
  },
};

// Helper to delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Race against a timeout
const generateWithTimeout = async (promise, ms) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT_Internal`)), ms);
    });
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timer);
        return result;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
};

export default async function handler(req, res) {
  // 1. Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { files } = req.body; 
    const apiKey = process.env.API_KEY ? process.env.API_KEY.trim() : "";

    if (!apiKey) {
      throw new Error("API Key is missing");
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    const parts = [];
    parts.push({
      text: `
        Task: OCR and Summarize Thai Document.
        Instructions: 
        1. Read text from images.
        2. Summarize into a CONCISE story in THAI (ภาษาไทย).
        3. STRICT LIMIT: Keep summary UNDER 200 WORDS. Brevity is key for speed.
        4. Tone: Natural Spoken Style (เล่าเรื่อง).
        5. Output JSON: { "originalText": "...", "summary": "..." }
      `
    });

    files.forEach(file => {
      parts.push({
        inlineData: { data: file.base64, mimeType: file.mimeType }
      });
    });

    const config = {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originalText: { type: Type.STRING },
          summary: { type: Type.STRING }
        }
      }
    };

    // === SPEED OPTIMIZED STRATEGY ===
    // Attempt 1: Gemini Flash Lite (Fastest) - 'gemini-flash-lite-latest'
    // Race against 8 seconds to beat Vercel 10s timeout
    try {
      console.log("Attempting Primary Model: gemini-flash-lite-latest (Speed Mode)");
      const response = await generateWithTimeout(
          ai.models.generateContent({
            model: 'gemini-flash-lite-latest',
            contents: { parts: parts },
            config: config
          }),
          8000 // 8 seconds max (Safe buffer for Vercel 10s limit)
      );
      
      const resultText = response.text;
      if (!resultText) throw new Error("Empty response");
      return res.status(200).json(JSON.parse(resultText));

    } catch (error) {
      console.warn("⚠️ Primary (Lite) failed or timed out:", error.message);
      
      const isQuota = error.message?.includes('429') || error.message?.includes('503') || error.message?.includes('Overloaded');
      const isTimeout = error.message?.includes('TIMEOUT_Internal');

      // If Quota or Timeout, try the standard Flash model as fallback
      if (isQuota || isTimeout) {
         console.log("🔄 Switching to Fallback Model: gemini-3-flash-preview");
         if (!isTimeout) await delay(500); 
         
         // Attempt 2: Gemini 3 Flash Preview
         // No timeout wrapper here, run until death
         const responseFallback = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: parts },
            config: config
         });
         const resultTextFallback = responseFallback.text;
         if (!resultTextFallback) throw new Error("Empty response from fallback");
         return res.status(200).json(JSON.parse(resultTextFallback));
      } else {
         throw error; // If real error (e.g. bad image), throw it
      }
    }

  } catch (error) {
    console.error("Vercel OCR Error:", error);
    // Map timeout errors to 504 to help frontend retry logic
    let status = 500;
    if (error.message?.includes('429')) status = 429;
    else if (error.message?.includes('TIMEOUT')) status = 504;
    
    res.status(status).json({ error: error.message || "OCR Processing Failed" });
  }
}
