
export interface FileData {
  base64: string;
  mimeType: string;
}

// Helper: Translate technical errors to friendly Thai messages
const getFriendlyErrorMessage = (error: any): string => {
  // Simple check if it's an object with a message property
  const msg = error.message || error.error || "Unknown error";
  
  if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
    return "⚠️ ระบบกำลังทำงานหนัก (คิวเต็ม): กรุณารอสักครู่แล้วลองใหม่";
  }
  return `เกิดข้อผิดพลาด: ${msg}`;
};

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  try {
    // Call our own Backend API
    const response = await fetch('/api/process-document', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server Error: ${response.status}`);
    }

    const data = await response.json();
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
    // Call our own Backend API
    const response = await fetch('/api/generate-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        text: cleanText,
        voiceName: voiceName
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.audioBase64) throw new Error("No Audio Data received");
    
    return data.audioBase64;

  } catch (error: any) {
    console.error("TTS Failed:", error);
    throw new Error(getFriendlyErrorMessage(error));
  }
};
