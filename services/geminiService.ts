import { GoogleGenerativeAI } from "@google/generative-ai";

// เรียก API Key
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export const getGeminiClient = () => {
  if (!API_KEY) {
    console.error("API Key is missing! Check VITE_GEMINI_API_KEY.");
  }
  return new GoogleGenerativeAI(API_KEY);
};

export interface FileData {
  base64: string;
  mimeType: string;
}

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  const genAI = getGeminiClient();
  // ใช้โมเดลมาตรฐาน flash 1.5 หรือ 2.0
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    Please act as a Thai language expert.
    1. Extract all text from these files.
    2. Summarize the content into a concise Thai story.
    Return JSON: { "originalText": "...", "summary": "..." }
  `;

  // แปลงไฟล์ให้ตรงรูปแบบ
  const fileParts = files.map(file => ({
    inlineData: { mimeType: file.mimeType, data: file.base64 }
  }));

  const result = await model.generateContent([prompt, ...fileParts]);
  const response = await result.response;
  
  // แกะ JSON ออกมา (แบบปลอดภัย)
  const text = response.text();
  const cleanJson = text.replace(/```json|```/g, '').trim(); 
  
  try {
      const parsed = JSON.parse(cleanJson);
      return {
        original: parsed.originalText || '',
        summary: parsed.summary || ''
      };
  } catch (e) {
      console.error("JSON Parse Error", e);
      return { original: text, summary: "Could not parse summary." };
  }
};

export const generateThaiSpeech = async (text: string): Promise<string> => {
    // ฟังก์ชันนี้ต้องใช้ Endpoint แยก หรือรอ SDK อัปเดต
    // เบื้องต้นให้ return ค่าว่าง หรือใช้บริการ TTS อื่นชั่วคราวถ้า SDK ยังไม่รองรับในเวอร์ชันนี้
    console.warn("Speech generation pending implementation for standard SDK");
    return ""; 
};


