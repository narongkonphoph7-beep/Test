
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
    Task: OCR and Summarize Thai Document.
    
    Instructions:
    1. READ all text from images carefully.
    2. SUMMARIZE the content into a cohesive story in THAI language (ภาษาไทย).
    
    RESPONSE FORMAT:
    You must return a valid JSON object. Do not add conversational text outside the JSON.
    {
      "originalText": "Extracted text...",
      "summary": "Summary story in Thai..."
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
          temperature: 0.5, // Reduced temperature for more deterministic JSON
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

      let resultText = data.choices[0].message?.content || "";
      
      if (!resultText.trim()) {
         // If empty content, force fallback to next model or error
         throw new Error("AI returned empty text");
      }

      console.log("Raw AI Response:", resultText);

      // 4. Robust JSON Parsing
      let result: any = null;

      // Method A: Try extracting JSON object via regex (find first { and last })
      const jsonStart = resultText.indexOf('{');
      const jsonEnd = resultText.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const potentialJson = resultText.substring(jsonStart, jsonEnd + 1);
        try {
          result = JSON.parse(potentialJson);
        } catch (e) {
          console.warn("Regex extraction failed, trying cleanup...");
        }
      }

      // Method B: Cleanup markdown blocks
      if (!result) {
         const cleanJson = resultText
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
         try {
            result = JSON.parse(cleanJson);
         } catch (e) {
            console.warn("Direct JSON parse failed");
         }
      }

      // 5. Determine Final Output
      if (result && (result.summary || result.originalText)) {
        // Success case with valid JSON
        return {
          original: result.originalText || "ไม่พบข้อความต้นฉบับ",
          summary: result.summary || "ไม่สามารถสรุปความได้"
        };
      } else {
        // Fallback: If JSON parsing failed OR result object was empty
        // Treat the entire raw text as the summary if it looks like text
        console.log("Using raw text fallback");
        return {
          original: "System: ไม่สามารถแยกรูปแบบข้อมูลได้ (Raw Output)",
          summary: resultText
        };
      }

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
