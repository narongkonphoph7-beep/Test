
import React, { useState, useRef, useEffect } from 'react';
import { 
  AppStatus, 
  AppState
} from './types';
import { 
  performOCRAndSummarize, 
  FileData
} from './services/geminiService';

// Components
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { ResultView } from './components/ResultView';

// Declare PDF.js types on window
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    status: AppStatus.IDLE,
    result: null,
    error: null,
    progressMessage: ''
  });
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  
  // Browser Speech Synthesis Reference
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Keep track of voices
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Load voices when app starts
  useEffect(() => {
    const loadVoices = () => {
      const availVoices = window.speechSynthesis.getVoices();
      // Sort voices: Prioritize "Google" or "Enhanced" voices for better quality
      const sortedVoices = availVoices.sort((a, b) => {
        const aScore = (a.name.includes('Google') || a.name.includes('Enhanced')) ? 1 : 0;
        const bScore = (b.name.includes('Google') || b.name.includes('Enhanced')) ? 1 : 0;
        return bScore - aScore;
      });
      setVoices(sortedVoices);
    };

    loadVoices();
    // Chrome needs this event, simple load works on others
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Generate previews when files change
  useEffect(() => {
    const urls = selectedFiles.map(file => URL.createObjectURL(file));
    setFilePreviews(urls);
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  const handleFileSelection = (files: File[]) => {
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Helper: Compress Image or Convert PDF to Image before sending to AI
  const compressFile = async (file: File): Promise<FileData> => {
    // === Handle PDF Files ===
    if (file.type === 'application/pdf') {
      return new Promise(async (resolve, reject) => {
        try {
          if (!window.pdfjsLib) {
             reject(new Error("PDF Processing Library not loaded. Please refresh."));
             return;
          }

          const arrayBuffer = await file.arrayBuffer();
          // Load the PDF document
          const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          
          // Fetch the first page (Currently supporting 1st page for stability)
          const page = await pdf.getPage(1);
          
          // Adjust scale for quality (2.0 is good for OCR)
          const viewport = page.getViewport({ scale: 2.0 });
          
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          if (!context) {
             reject(new Error("Canvas context not available"));
             return;
          }

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport
          };

          await page.render(renderContext).promise;
          
          // Convert to JPEG
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          
          resolve({
            base64: dataUrl.split(',')[1],
            mimeType: 'image/jpeg' // Treat as JPEG for the AI Model
          });
          
        } catch (error) {
          console.error("PDF Conversion Error:", error);
          reject(new Error("ไม่สามารถอ่านไฟล์ PDF นี้ได้"));
        }
      });
    }

    // === Handle Image Files ===
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_WIDTH = 1500; 
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve({
            base64: dataUrl.split(',')[1],
            mimeType: 'image/jpeg'
          });
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  };

  const handleStartProcessing = async () => {
    if (selectedFiles.length === 0) return;

    try {
      const fileCount = selectedFiles.length;
      setState(prev => ({ 
        ...prev, 
        status: AppStatus.UPLOADING, 
        progressMessage: `กำลังแปลงไฟล์และอัปโหลด ${fileCount} รายการ (OpenRouter)...` 
      }));
      
      const filesData = await Promise.all(selectedFiles.map(compressFile));

      // OCR + Summarize via OpenRouter
      setState(prev => ({ ...prev, status: AppStatus.PROCESSING_OCR, progressMessage: `AI กำลังอ่านและสรุปใจความ...` }));
      const { original, summary } = await performOCRAndSummarize(filesData);

      // Skip TTS Generation step (we use browser TTS on click)
      setState({
        status: AppStatus.COMPLETED,
        result: {
          originalText: original,
          summary: summary
        },
        error: null,
        progressMessage: 'เรียบร้อยแล้ว!'
      });
    } catch (err: any) {
      console.error(err);
      
      let errorMsg = err.message || 'เกิดข้อผิดพลาดบางอย่าง โปรดลองอีกครั้ง';
      if (err.message?.includes('401')) {
        errorMsg = "⚠️ API Key ไม่ถูกต้อง โปรดตรวจสอบ OpenRouter Key";
      }

      setState(prev => ({ 
        ...prev, 
        status: AppStatus.ERROR, 
        error: errorMsg 
      }));
    }
  };

  const playAudio = () => {
    if (!state.result?.summary) return;
    
    // 1. Stop any current speech and Reset
    window.speechSynthesis.cancel();
    setIsAudioPlaying(true);

    const fullText = state.result.summary;
    
    // 2. Advanced Voice Selection: Try to find Google Thai or best available
    let thaiVoice = voices.find(v => v.lang === 'th-TH' && v.name.includes('Google')); // Android/Chrome Best
    if (!thaiVoice) thaiVoice = voices.find(v => v.lang === 'th-TH' && v.name.includes('Narisa')); // Mac Best
    if (!thaiVoice) thaiVoice = voices.find(v => v.lang.includes('th')); // Fallback

    // 3. Smart Chunking (Fix Stuttering)
    // Instead of cutting every 150 chars, we only cut at Newlines or if absolutely necessary.
    // Modern browsers can handle ~32KB, but timeout after ~15 seconds.
    // 500 Thai chars is roughly 10-15 seconds of speech.
    const CHUNK_LIMIT = 500;
    
    const rawParagraphs = fullText.split(/[\n\r]+/);
    const chunks: string[] = [];

    rawParagraphs.forEach(para => {
      if (para.length <= CHUNK_LIMIT) {
        if (para.trim()) chunks.push(para.trim());
      } else {
        // If paragraph is HUGE, split by spaces (Thai phrases)
        const words = para.split(' ');
        let currentChunk = '';
        
        words.forEach(word => {
          if ((currentChunk + word).length > CHUNK_LIMIT) {
            chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          } else {
            currentChunk += word + ' ';
          }
        });
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
      }
    });

    if (chunks.length === 0) {
        setIsAudioPlaying(false);
        return;
    }

    // 4. Play Queue
    let currentChunkIndex = 0;

    const speakNext = () => {
      if (currentChunkIndex >= chunks.length) {
        setIsAudioPlaying(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[currentChunkIndex]);
      utterance.lang = 'th-TH';
      if (thaiVoice) utterance.voice = thaiVoice;
      utterance.rate = 1.0; // Normal speed
      utterance.pitch = 1.0;

      utterance.onend = () => {
        currentChunkIndex++;
        speakNext();
      };

      utterance.onerror = (e) => {
        console.error("TTS Error:", e);
        // Don't stop completely on one chunk error, try next
        currentChunkIndex++;
        speakNext();
      };

      speechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  };

  const stopAudio = () => {
    window.speechSynthesis.cancel();
    setIsAudioPlaying(false);
  };

  const reset = () => {
    stopAudio();
    setState({
      status: AppStatus.IDLE,
      result: null,
      error: null,
      progressMessage: ''
    });
    setSelectedFiles([]);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12 flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-grow flex flex-col items-center justify-center space-y-8 mt-12">
        {state.status === AppStatus.IDLE && (
          <div className="w-full animate-fade-in">
            {selectedFiles.length === 0 ? (
              <>
                <div className="text-center mb-10">
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">เริ่มสร้างเรื่องเล่าจากเอกสาร</h2>
                  <p className="text-gray-600">อัปโหลดรูปภาพ หรือ PDF เอกสารภาษาไทยของคุณที่นี่</p>
                </div>
                <FileUploader onUpload={handleFileSelection} />
              </>
            ) : (
              <div className="w-full">
                <div className="flex justify-between items-center mb-6">
                   <h2 className="text-2xl font-bold text-gray-800">เอกสารที่เลือก ({selectedFiles.length})</h2>
                   <button 
                     onClick={() => setSelectedFiles([])}
                     className="text-red-500 hover:text-red-700 text-sm font-semibold"
                   >
                     ล้างทั้งหมด
                   </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {filePreviews.map((url, index) => {
                    const isPdf = selectedFiles[index].type === 'application/pdf';
                    return (
                      <div key={index} className="relative group aspect-[3/4] bg-gray-100 rounded-xl overflow-hidden shadow-md border border-gray-200">
                        {isPdf ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 text-red-500">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
                             </svg>
                             <span className="text-sm font-bold mt-2">PDF</span>
                          </div>
                        ) : (
                          <img src={url} alt={`Preview ${index}`} className="w-full h-full object-cover" />
                        )}
                        <button 
                          onClick={() => removeFile(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-2 truncate">
                          {selectedFiles[index].name}
                        </div>
                      </div>
                    );
                  })}
                  
                  <div className="relative aspect-[3/4]">
                    <FileUploader onUpload={handleFileSelection} compact={true} />
                  </div>
                </div>

                <div className="flex justify-center mt-8">
                  <button
                    onClick={handleStartProcessing}
                    className="bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white text-xl font-bold py-4 px-12 rounded-full shadow-xl hover:shadow-2xl transform transition hover:-translate-y-1 active:scale-95 flex items-center space-x-3"
                  >
                    <span>⚡</span>
                    <span>เริ่มประมวลผล (OpenRouter)</span>
                  </button>
                </div>
              </div>
            )}
            
            {selectedFiles.length === 0 && (
              <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">👁️</div>
                  <h3 className="font-semibold text-lg mb-2">The Eye (Thai OCR)</h3>
                  <p className="text-sm text-gray-500">อ่านข้อความภาษาไทยได้แม่นยำ แม้เป็นภาพถ่ายหลายหน้า</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">🧠</div>
                  <h3 className="font-semibold text-lg mb-2">The Brain (AI Summary)</h3>
                  <p className="text-sm text-gray-500">รวบรวมเนื้อหาจากทุกหน้า สรุปใจความสำคัญให้เข้าใจง่าย</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">🔊</div>
                  <h3 className="font-semibold text-lg mb-2">Free Voice (Web TTS)</h3>
                  <p className="text-sm text-gray-500">ฟังเสียงบรรยายได้ฟรีและไม่จำกัดด้วยระบบเสียงของเบราว์เซอร์</p>
                </div>
              </section>
            )}
          </div>
        )}

        {state.status !== AppStatus.IDLE && state.status !== AppStatus.COMPLETED && state.status !== AppStatus.ERROR && (
          <ProcessingOverlay status={state.status} message={state.progressMessage} />
        )}

        {state.status === AppStatus.COMPLETED && state.result && (
          <ResultView 
            result={state.result} 
            isPlaying={isAudioPlaying}
            onPlay={playAudio} 
            onStop={stopAudio}
            onReset={reset} 
          />
        )}

        {state.status === AppStatus.ERROR && (
          <div className="bg-red-50 border border-red-200 p-8 rounded-3xl text-center max-w-md w-full shadow-lg">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold text-red-800 mb-2">เกิดข้อผิดพลาด</h3>
            <p className="text-red-600 mb-6">{state.error}</p>
            <button 
              onClick={reset}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition transform active:scale-95"
            >
              ลองใหม่อีกครั้ง
            </button>
          </div>
        )}
      </main>

      <footer className="mt-16 text-center text-gray-500 text-sm">
        <p>@จัดทำโดย น้องปอนด์สุดหล่อจาก CS68  🚀</p>
      </footer>
    </div>
  );
};

export default App;
