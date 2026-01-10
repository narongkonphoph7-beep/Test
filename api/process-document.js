
import { GoogleGenAI, Type } from "@google/genai";

// Vercel Serverless Function Configuration
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb', // Maximum allowed on Vercel Free Tier
    },
  },
};

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export default async function handler(req, res) {
  // 1. Handle CORS (Allow connection from your frontend)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { files } = req.body; 

    if (!process.env.API_KEY) {
      throw new Error("API Key missing in Vercel Environment Variables");
    }

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
    res.status(200).json(data);

  } catch (error) {
    console.error("Vercel OCR Error:", error);
    res.status(500).json({ error: error.message || "OCR Processing Failed" });
  }
}
