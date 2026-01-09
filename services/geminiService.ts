
// The build process replaces this with the actual string
const API_KEY = process.env.API_KEY || '';

export interface FileData {
  base64: string;
  mimeType: string;
}

// List of models to try in order.
// We prioritize Qwen 2.5 VL (72B) for quality, but use 7B (from your snippet) as a fast backup.
const MODEL_FALLBACKS = [
  "qwen/qwen-2.5-vl-72b-instruct:free",       // Best Quality (72B parameter)
  "qwen/qwen-2.5-vl-7b-instruct:free",        // Fast Backup (7B parameter) - Added from your snippet
  "google/gemini-2.0-flash-lite-preview-02-05:free", // Gemini Backup 1
  "google/gemini-2.0-pro-exp-02-05:free",            // Gemini Backup 2
  "google/gemini-2.0-flash-exp:free",                // Gemini Backup 3
];

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
    // OpenRouter standardizes image input for Vision models (Qwen, Gemini, Llama Vision)
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${file.mimeType};base64,${file.base64}`
      }
    });
  });

  let lastError: any = null;

  // 3. Try models in sequence (Fallback Logic)
  for (const model of MODEL_FALLBACKS) {
    try {
      console.log(`Attempting with model: ${model}`);
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": typeof window !== 'undefined' ? window.location.origin : 'https://thaisight.app',
          "X-Title": "ThaiSight AI"
        },
        body: JSON.stringify({
          model: model, 
          messages: [
            {
              role: "user",
              content: content
            }
          ],
          temperature: 0.7,
          // Some models require max_tokens to prevent cutting off
          max_tokens: 4000 
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Status ${response.status}`;
        console.warn(`Model ${model} failed: ${errorMessage}`);
        
        // If it's a client error (e.g. Invalid Image), don't retry other models, just fail.
        if (response.status === 400 || response.status === 401) {
           throw new Error(errorMessage);
        }
        
        throw new Error(errorMessage); // Throw to trigger next model in loop
      }

      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error("Empty response from AI provider");
      }

      const resultText = data.choices[0].message?.content || "{}";

      // 4. Parse JSON
      // Handle Markdown code blocks often returned by LLMs
      const cleanJson = resultText.replace(/```json\n?|\n?```/g, '').trim();
      
      let result;
      try {
        result = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error("JSON Parse Error:", parseError, "Raw Text:", resultText);
        // Fallback: If AI didn't return perfect JSON, treat the whole text as summary
        // Qwen sometimes is chatty, so this safety net is important.
        return {
          original: "ไม่สามารถแยกข้อความต้นฉบับได้ (JSON Parse Error)",
          summary: resultText
        };
      }

      return {
        original: result.originalText || '',
        summary: result.summary || ''
      };

    } catch (error: any) {
      lastError = error;
      // Continue to next model in loop
    }
  }

  // If all models fail
  console.error("All models failed. Last error:", lastError);
  
  if (lastError?.message?.includes('Provider returned error')) {
    throw new Error("ระบบ AI ปลายทางขัดข้องชั่วคราว (Provider Error) กรุณาลองใหม่ หรือเปลี่ยนไฟล์ภาพ");
  }
  
  throw lastError || new Error("ไม่สามารถประมวลผลได้ในขณะนี้ กรุณาลองใหม่ภายหลัง");
};
