
import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY || '';

export const getGeminiClient = () => {
  return new GoogleGenAI({ apiKey: API_KEY });
};

export const performOCRAndSummarize = async (imagesBase64: string[]): Promise<{ original: string; summary: string }> => {
  const ai = getGeminiClient();
  
  const prompt = `
    Please act as a Thai language expert.
    1. Extract all text from these images (OCR). These images are pages of the same document or related content. Combine the text logically. Fix any obvious spelling mistakes or OCR errors to ensure the text is clean.
    2. Summarize the content of the entire document into a concise, easy-to-understand "story" format in Thai. 
    Focus on key points and takeaways.
    
    Return the response in exactly this JSON format:
    {
      "originalText": "The full cleaned text from all images here",
      "summary": "The concise summary here"
    }
  `;

  // Create image parts for every image provided
  const imageParts = imagesBase64.map(base64 => ({
    inlineData: { mimeType: 'image/jpeg', data: base64 }
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        ...imageParts,
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json"
    }
  });

  const result = JSON.parse(response.text || '{}');
  return {
    original: result.originalText || '',
    summary: result.summary || ''
  };
};

export const generateThaiSpeech = async (text: string): Promise<string> => {
  const ai = getGeminiClient();
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `โปรดอ่านสรุปต่อไปนี้ด้วยน้ำเสียงที่นุ่มนวลและเป็นธรรมชาติ: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Could not generate audio content");
  
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
