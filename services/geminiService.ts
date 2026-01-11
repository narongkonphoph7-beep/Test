
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
  // Updated specific message for Quota/429
  if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests') || msg.includes('RESOURCE_EXHAUSTED')) {
    return "⚠️ โควต้าเต็ม (429): กรุณารอสักครู่ หรืออัปเกรด API Key ใน Google Cloud เป็นแบบชำระเงิน (Pay-as-you-go) เพื่อใช้งานต่อเนื่อง";
  }
  if (msg.includes('413') || msg.includes('Payload Too Large')) {
    return "⚠️ ไฟล์มีขนาดใหญ่เกินไป กรุณาลดขนาดไฟล์หรือจำนวนหน้า";
  }
  if (msg.includes('Server Error') || msg.includes('Unexpected token')) {
    return `⚠️ เชื่อมต่อ Server ไม่สำเร็จ (${msg})`;
  }
  if (msg.includes('The operation was aborted') || msg.includes('Timeout') || msg.name === 'AbortError') {
    return "การทำงานถูกยกเลิก หรือล่าช้าเกินกำหนด";
  }
  return `เกิดข้อผิดพลาด: ${msg}`;
};

// Helper: Safe fetch wrapper with timeout
const safeFetch = async (url: string, options: RequestInit, signal?: AbortSignal) => {
  // Increased timeout to 120 seconds for robustness
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); 

  // Combine signals (User abort + Timeout abort)
  const fetchSignal = signal || controller.signal;
  
  // If a parent signal is provided, listen to it to abort the fetch properly
  if (signal) {
      if (signal.aborted) {
          clearTimeout(timeoutId);
          throw new DOMException('Aborted', 'AbortError');
      }
      signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          controller.abort();
      });
  }

  try {
    const response = await fetch(url, { ...options, signal: fetchSignal });
    clearTimeout(timeoutId);
    
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // If we can't parse JSON, it's likely an HTML error page (404/500/504)
      console.error(`API Error (${url}):`, text.substring(0, 200)); 
      throw new Error(`Server Error ${response.status}: API Not Found or Error.`);
    }

    if (!response.ok) {
      // Include status in error message to help detection
      throw new Error(data.error || `Server Error: ${response.status} ${data.message || ''}`);
    }

    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
       throw err; // Re-throw abort error cleanly
    }
    throw err;
  }
};

export const performOCRAndSummarize = async (files: FileData[], signal?: AbortSignal): Promise<{ original: string; summary: string }> => {
  try {
    const data = await safeFetch('/api/process-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    }, signal);

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

// Added 'signal' parameter to support cancellation
export const generateNaturalSpeech = async (text: string, voiceName: string, signal?: AbortSignal): Promise<string> => {
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
    }, signal);

    if (!data.audioBase64) throw new Error("No Audio Data received");
    return data.audioBase64;

  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.error("TTS Failed:", error);
    throw new Error(getFriendlyErrorMessage(error));
  }
};
