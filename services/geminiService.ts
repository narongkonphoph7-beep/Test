
import { GoogleGenAI, Type, Modality } from "@google/genai";

// Initialize the Google GenAI Client with the API Key from environment variables
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface FileData {
  base64: string;
  mimeType: string;
}

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  // Ensure API Key is available
  if (!process.env.API_KEY) {
    throw new Error("ไม่พบ API Key (API Key Missing). กรุณาตรวจสอบการตั้งค่า API Key");
  }

  try {
    const parts: any[] = [];

    // 1. Add System Instructions / Prompt as a text part
    parts.push({
      text: `
        Task: OCR and Summarize Thai Document.
        
        Instructions:
        1. READ all text from images carefully.
        2. SUMMARIZE the content into a cohesive story in THAI language (ภาษาไทย).
        
        CRITICAL ACCURACY RULES:
        - NUMBERS & DATA: You MUST preserve all numbers, dates, times, and prices EXACTLY as they appear. 
        - DO NOT SWAP DIGITS: (e.g., "02" must remain "02", DO NOT change to "20"). Check every number twice against the image.
        - ACCURACY OVER CREATIVITY: If there is specific data, prioritize correctness over storytelling flair.
        
        Tone & Format:
        - Make the summary natural and easy to listen to (Spoken Style).
        - Do NOT use markdown formatting (like bold **, italics *, headers #) in the summary. Keep it plain text.
        
        Output Requirements:
        - Return strictly JSON.
        - Fields: "originalText" (extracted text), "summary" (summarized story).
      `
    });

    // 2. Add Images
    files.forEach(file => {
      parts.push({
        inlineData: {
          data: file.base64,
          mimeType: file.mimeType
        }
      });
    });

    // 3. Call Gemini API
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: parts },
      config: {
        temperature: 0.3, // Lower temperature to increase accuracy and reduce hallucinations
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

    // 4. Extract and Parse Result
    const resultText = response.text;
    
    if (!resultText) {
      throw new Error("AI returned empty response");
    }

    const data = JSON.parse(resultText);

    return {
      original: data.originalText || "ไม่พบข้อความต้นฉบับ",
      summary: data.summary || "ไม่สามารถสรุปความได้"
    };

  } catch (error: any) {
    console.error("Gemini Service Error:", error);
    let message = error.message || "เกิดข้อผิดพลาดในการประมวลผล";
    if (message.includes("401") || message.includes("403") || message.includes("auth")) {
        message = "API Key ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง (Access Denied)";
    }
    throw new Error(message);
  }
};

const sanitizeForTTS = (text: string): string => {
  return text
    .replace(/[*#_`~]/g, '') // Remove Markdown bold, italic, code, strike
    .replace(/\[.*?\]/g, '') // Remove links text
    .replace(/\(https?:\/\/.*?\)/g, '') // Remove link URLs
    .replace(/https?:\/\/\S+/g, '') // Remove raw URLs
    .replace(/\.{2,}/g, '.') // Replace multiple dots (e.g., ".....") with a single dot to prevent long pauses
    .replace(/[\r\n]+/g, ' ') // Replace newlines with space
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
};

export const generateNaturalSpeech = async (text: string, voiceName: string): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("ไม่พบ API Key");
  }

  // Sanitize text
  const cleanText = sanitizeForTTS(text);

  // Check if text has any audible content (Thai or English alphanumerics)
  const hasAudibleContent = /[ก-๙a-zA-Z0-9]/.test(cleanText);

  if (!cleanText || cleanText.length === 0 || !hasAudibleContent) {
    console.warn("Skipping TTS for empty/invalid text chunk:", text);
    // Return empty string to signal skip, or throw specific error?
    // Let's throw a skippable error to handle in the loop
    throw new Error("SKIPPABLE_EMPTY_TEXT");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      console.warn("TTS Warning: No audio data returned for text:", cleanText);
      throw new Error("AI ไม่ส่งข้อมูลเสียงกลับมา");
    }

    return base64Audio;
  } catch (error: any) {
    console.error("TTS Service Error:", error);
    throw new Error("ไม่สามารถสร้างเสียง AI ได้: " + error.message);
  }
};
