import { GoogleGenAI } from "@google/genai";

// 1. แก้ไขตรงนี้: เรียกใช้ตัวแปรให้ถูกต้องตามฉบับ Vite และชื่อที่ตั้งใน Vercel
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export const getGeminiClient = () => {
  // ตรวจสอบว่ามี Key หรือไม่ (กัน Error)
  if (!API_KEY) {
    console.error("API Key is missing! Please check VITE_GEMINI_API_KEY in .env or Vercel settings.");
  }
  return new GoogleGenAI({ apiKey: API_KEY });
};

export interface FileData {
  base64: string;
  mimeType: string;
}

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  const ai = getGeminiClient();
  
  const prompt = `
    Please act as a Thai language expert.
    1. Extract all text from these files (OCR). These files are pages of the same document or related content (can be images or PDFs). Combine the text logically. Fix any obvious spelling mistakes or OCR errors to ensure the text is clean.
    2. Summarize the content of the entire document into a concise, easy-to-understand "story" format in Thai. 
    Focus on key points and takeaways.
    
    Return the response in exactly this JSON format:
    {
      "originalText": "The full cleaned text from all files here",
      "summary": "The concise summary here"
    }
  `;

  // Create parts for every file provided
  const fileParts = files.map(file => ({
    inlineData: { mimeType: file.mimeType, data: file.base64 }
  }));

  const response = await ai.models.generateContent({
    // 2. แก้ไขชื่อโมเดล: ใช้ gemini-2.0-flash-exp (รุ่นปัจจุบันที่ทำงานได้จริง)
    model: 'gemini-2.0-flash-exp',
    contents: [
      {
        parts: [
          ...fileParts,
          { text: prompt }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json"
    }
  });

  // แก้ไขการดึงข้อมูล JSON ให้ปลอดภัยขึ้น
  const textResponse = response.text ? response.text() : '{}';
  const result = JSON.parse(textResponse);
  
  return {
    original: result.originalText || '',
    summary: result.summary || ''
  };
};

export const generateThaiSpeech = async (text: string): Promise<string> => {
  const ai = getGeminiClient();
  
  const response = await ai.models.generateContent({
    // ใช้โมเดลเดียวกันที่รองรับ Audio Generation
    model: "gemini-2.0-flash-exp",
    contents: [
        { 
            parts: [
                { text: `โปรดอ่านสรุปต่อไปนี้ด้วยน้ำเสียงที่นุ่มนวลและเป็นธรรมชาติ: ${text}` }
            ] 
        }
    ],
    config: {
      responseModalities: ["AUDIO"], // ใช้ String แทน Enum เพื่อลดปัญหา import
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  // ดึงข้อมูลเสียง (Base64)
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
      throw new Error("Could not generate audio content");
  }
  
  return base64Audio;
};

// Audio Utilities for raw PCM
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
