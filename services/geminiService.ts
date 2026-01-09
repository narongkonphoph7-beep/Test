
// The build process replaces this with the actual string
const API_KEY = process.env.API_KEY || '';

export interface FileData {
  base64: string;
  mimeType: string;
}

export const performOCRAndSummarize = async (files: FileData[]): Promise<{ original: string; summary: string }> => {
  if (!API_KEY) {
    throw new Error("ไม่พบ API Key (API Key Missing). กรุณาตรวจสอบการตั้งค่า OpenRouter API Key");
  }

  // 1. Prepare Prompt
  const promptText = `
    Task: Thai Document Analysis.
    1. Extract ALL text from the provided images (OCR). Combine logically.
    2. Summarize the content into a cohesive, easy-to-understand "Story" in THAI language.
    
    Output strictly in this JSON format (do not use markdown code blocks):
    {
      "originalText": "All extracted text here...",
      "summary": "Thai summary story here..."
    }
  `;

  // 2. Prepare Content Array (Text + Images)
  const content: any[] = [
    { type: "text", text: promptText }
  ];

  files.forEach(file => {
    // OpenRouter (OpenAI-compatible) expects "image_url" with data URI
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${file.mimeType};base64,${file.base64}`
      }
    });
  });

  try {
    // 3. Call OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": typeof window !== 'undefined' ? window.location.origin : '',
        "X-Title": "ThaiSight AI"
      },
      body: JSON.stringify({
        // Using Gemini 2.0 Flash via OpenRouter (Free tier available)
        model: "google/gemini-2.0-flash-exp:free", 
        messages: [
          {
            role: "user",
            content: content
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenRouter API Error: ${response.status}`);
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content || "{}";

    // 4. Parse JSON (Handle potential markdown wrapping)
    const cleanJson = resultText.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    return {
      original: result.originalText || '',
      summary: result.summary || ''
    };

  } catch (error: any) {
    console.error("OpenRouter Processing Error:", error);
    if (error.message?.includes('429')) {
       throw new Error("ระบบกำลังทำงานหนัก (Rate Limit) กรุณารอสักครู่แล้วลองใหม่");
    }
    throw error;
  }
};
