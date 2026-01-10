
export interface FileData {
  base64: string;
  mimeType: string;
}

// Helper: Translate technical errors to friendly Thai messages
const getFriendlyErrorMessage = (error: any): string => {
  const msg = error.message || error.error || "Unknown error";
  
  if (msg.includes('API key not valid') || msg.includes('API Key is missing')) {
    return "⚠️ API Key ผิดพลาด: กรุณาตรวจสอบการตั้งค่าใน Vercel (Settings > Environment Variables)";
  }
  if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
    return "⚠️ ระบบกำลังทำงานหนัก (คิวเต็ม): กรุณารอสักครู่แล้วลองใหม่";
  }
  if (msg.includes('413') || msg.includes('Payload Too Large')) {
    return "⚠️ ไฟล์มีขนาดใหญ่เกินไป กรุณาลดขนาดไฟล์หรือจำนวนหน้า";
  }
  if (msg.includes('Server Error') || msg.includes('Unexpected token')) {
    return `⚠️ เชื่อมต่อ Server ไม่สำเร็จ (${msg})`;
  }
  return `เกิดข้อผิดพลาด: ${msg}`;
};

// Helper: Safe fetch wrapper
const safeFetch = async (url: string, options: RequestInit) => {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // If we can't parse JSON, it's likely an HTML error page (404/500)
    console.error(`API Error (${url}):`, text.substring(0, 200)); // Log for debugging
    throw new Error(`Server Error ${response.status}: API Not Found or Error.`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Server Error: ${response.status}`);
  }

  return data;
};

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  try {
    const data = await safeFetch('/api/process-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });

    return {
      original: data.originalText || "ไม่พบข้อความ",
      summary: data.summary || "สรุปไม่ได้"
    };

  } catch (error: any) {
    console.error("OCR Service Error:", error);
    throw new Error(getFriendlyErrorMessage(error));
  }
};

const sanitizeForTTS = (text: string): string => {
  return text.replace(/[*#_`~\[\]]/g, '').replace(/\s+/g, ' ').trim();
};

export const generateNaturalSpeech = async (text: string, voiceName: string): Promise<string> => {
  const cleanText = sanitizeForTTS(text);
  if (!cleanText) throw new Error("SKIPPABLE_EMPTY_TEXT");

  try {
    const data = await safeFetch('/api/generate-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: cleanText,
        voiceName: voiceName
      }),
    });

    if (!data.audioBase64) throw new Error("No Audio Data received");
    return data.audioBase64;

  } catch (error: any) {
    console.error("TTS Failed:", error);
    throw new Error(getFriendlyErrorMessage(error));
  }
};
