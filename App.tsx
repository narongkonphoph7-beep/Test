
import React, { useState, useRef, useEffect } from 'react';
import { 
  AppStatus, 
  AppState
} from './types';
import { 
  performOCRAndSummarize, 
  generateNaturalSpeech,
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

// === PCM DECODING HELPERS ===
const base64ToBytes = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const pcmToAudioBuffer = (data: Uint8Array, audioContext: AudioContext): AudioBuffer => {
  const sampleRate = 24000;
  const numChannels = 1;
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

// === SIMPLE SPLITTER ===
const splitTextSimple = (text: string): string[] => {
  const chunks: string[] = [];
  // MAXIMIZED CHUNK SIZE: 4000 chars per request.
  const maxChunkSize = 4000; 
  
  let currentChunk = "";
  const sentences = text.split(/([\n.!?]+)/);

  for (const s of sentences) {
    if ((currentChunk.length + s.length) > maxChunkSize && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = s;
    } else {
      currentChunk += s;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    status: AppStatus.IDLE,
    result: null,
    error: null,
    progressMessage: ''
  });
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  
  // Audio State
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck'); 
  
  // The Master Audio Buffer (Pre-loaded)
  const masterAudioBufferRef = useRef<AudioBuffer | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Cancellation Ref
  const abortControllerRef = useRef<AbortController | null>(null);

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Dark Mode Effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

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

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const compressFile = async (file: File): Promise<FileData> => {
    if (file.type === 'application/pdf') {
      return new Promise(async (resolve, reject) => {
        try {
          if (!window.pdfjsLib) {
             reject(new Error("PDF Lib not loaded."));
             return;
          }
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);
          // Reduced scale drastically for speed
          const viewport = page.getViewport({ scale: 1.0 }); 
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          if (!context) {
             reject(new Error("No Canvas context"));
             return;
          }
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          // SUPER COMPRESSION: Quality 0.5
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); 
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        } catch (error) {
          reject(new Error("Cannot read PDF"));
        }
      });
    }

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
          
          // AGGRESSIVE RESIZE: Max width 768px (iPad portrait width) is enough for OCR
          // This reduces payload size by ~60% compared to 1024px
          const MAX_WIDTH = 768; 
          
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // AGGRESSIVE COMPRESSION: Quality 0.5
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  };

  // Helper: Generic Wait with Countdown
  const waitWithCountdown = async (seconds: number, message: string) => {
    for(let i = seconds; i > 0; i--) {
      // Check cancellation
      if (abortControllerRef.current?.signal.aborted) return;
      
      setState(prev => ({
         ...prev,
         progressMessage: `⏳ ระบบทำงานหนัก: ${message} (รอรีเซ็ต ${i} วินาที)`
      }));
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // Helper: Check for Quota or Retryable Errors (Includes 504/502)
  const isRetryableError = (e: any) => {
    const msg = (e.message || '').toLowerCase();
    return msg.includes('429') || 
           msg.includes('503') || 
           msg.includes('504') || 
           msg.includes('502') || 
           msg.includes('overloaded') || 
           msg.includes('ระบบกำลังทำงานหนัก') || 
           msg.includes('คิวเต็ม') ||
           msg.includes('โควต้าเต็ม') ||
           msg.includes('timeout') ||
           msg.includes('connection error');
  };

  // --- CORE FUNCTION: Prepare Full Audio Buffer ---
  // Now runs in background, doesn't block UI
  const prepareFullAudio = async (text: string, voice: string) => {
    const ctx = getAudioContext();
    const chunks = splitTextSimple(text);
    const audioBuffers: AudioBuffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      // Small delay to be safe
      if (i > 0) {
        await new Promise(r => setTimeout(r, 100));
      }

      let attempt = 0;
      const maxRetries = 15; // Increased even more
      let success = false;

      while (attempt < maxRetries && !success) {
        try {
          setState(prev => ({ ...prev, progressMessage: `กำลังสร้างเสียงบรรยาย... (ส่วนที่ ${i + 1}/${chunks.length})` }));
          const b64 = await generateNaturalSpeech(chunks[i], voice);
          const buffer = pcmToAudioBuffer(base64ToBytes(b64), ctx);
          audioBuffers.push(buffer);
          success = true;
        } catch (e: any) {
           attempt++;
           console.warn(`Audio chunk ${i+1}/${chunks.length} failed:`, e);

           if (attempt >= maxRetries) throw e;

           if (isRetryableError(e)) {
             const waitSeconds = attempt * 3; // 3, 6, 9, 12...
             await waitWithCountdown(waitSeconds, `กำลังลองใหม่ครั้งที่ ${attempt}`);
           } else {
             await new Promise(r => setTimeout(r, 2000));
           }
        }
      }
    }

    if (audioBuffers.length === 0) return null;

    const totalLength = audioBuffers.reduce((acc, b) => acc + b.length, 0);
    const masterBuffer = ctx.createBuffer(1, totalLength, 24000);
    const channelData = masterBuffer.getChannelData(0);

    let offset = 0;
    for (const buffer of audioBuffers) {
      channelData.set(buffer.getChannelData(0), offset);
      offset += buffer.length;
    }

    return masterBuffer;
  };

  const handleStartProcessing = async () => {
    if (selectedFiles.length === 0) return;

    // Reset AbortController
    abortControllerRef.current = new AbortController();

    try {
      stopAudio();
      masterAudioBufferRef.current = null;

      const fileCount = selectedFiles.length;
      setState(prev => ({ ...prev, status: AppStatus.UPLOADING, progressMessage: `กำลังแปลงไฟล์ ${fileCount} รายการ...` }));
      
      const filesData = await Promise.all(selectedFiles.map(compressFile));

      if (abortControllerRef.current.signal.aborted) return;

      setState(prev => ({ ...prev, status: AppStatus.PROCESSING_OCR, progressMessage: `กำลังอ่านและสรุปใจความ (โหมดความเร็วสูง)...` }));
      
      // === OCR RETRY LOOP ===
      let summaryData = null;
      let ocrAttempt = 0;
      const maxOcrRetries = 10;
      
      while (!summaryData && ocrAttempt < maxOcrRetries) {
          if (abortControllerRef.current.signal.aborted) return;

          try {
              // Pass signal to service
              summaryData = await performOCRAndSummarize(filesData, abortControllerRef.current.signal);
          } catch (e: any) {
              if (abortControllerRef.current.signal.aborted) return;

              ocrAttempt++;
              if (ocrAttempt >= maxOcrRetries) throw e;
              
              if (isRetryableError(e)) {
                  await waitWithCountdown(ocrAttempt * 3, `ระบบอ่านเอกสารกำลังทำงานหนัก (ลองใหม่ ${ocrAttempt}/${maxOcrRetries})`);
                  // Reset message after wait
                  setState(prev => ({ ...prev, progressMessage: `กำลังอ่านและสรุปใจความ...` }));
              } else {
                  throw e; // Non-retryable error, fail immediately
              }
          }
      }
      
      if (!summaryData) throw new Error("Failed to process document after multiple attempts.");
      const { original, summary } = summaryData;

      // === SHOW RESULT IMMEDIATELY ===
      setState({
        status: AppStatus.COMPLETED,
        result: { 
          originalText: original, 
          summary: summary,
          isAudioUnavailable: false
        },
        error: null,
        progressMessage: 'เรียบร้อยแล้ว!'
      });

      // === START AUDIO IN BACKGROUND ===
      generateAudioInBackground(summary, selectedVoice);

    } catch (err: any) {
      if (err.name === 'AbortError') return; // Ignore cancellation errors
      console.error(err);
      setState(prev => ({ ...prev, status: AppStatus.ERROR, error: err.message || 'เกิดข้อผิดพลาดในการประมวลผล' }));
    }
  };
  
  const handleCancel = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
      }
      stopAudio();
      setIsGeneratingAudio(false);
      setState({ status: AppStatus.IDLE, result: null, error: null, progressMessage: '' });
  };

  const generateAudioInBackground = async (text: string, voice: string) => {
    setIsGeneratingAudio(true);
    try {
      // Re-generate audio context if needed
      if (!audioContextRef.current) getAudioContext();
      
      const fullBuffer = await prepareFullAudio(text, voice);
      masterAudioBufferRef.current = fullBuffer;
      setIsGeneratingAudio(false);
    } catch (audioErr) {
      console.error("Background audio failed:", audioErr);
      setIsGeneratingAudio(false);
      // Mark audio as unavailable in UI
      setState(prev => {
        if (prev.result) {
            return { 
                ...prev, 
                result: { ...prev.result, isAudioUnavailable: true } 
            };
        }
        return prev;
      });
    }
  };

  const handlePlay = async () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    if (state.result?.isAudioUnavailable) {
       // If it failed before, try one more time on click!
       if (state.result?.summary) {
          // Reset unavailability flag to try again
          setState(prev => prev.result ? ({...prev, result: {...prev.result, isAudioUnavailable: false}}) : prev);
          generateAudioInBackground(state.result.summary, selectedVoice);
       } else {
          alert("ขออภัย: โควต้าสร้างเสียงเต็มในขณะนี้ คุณสามารถอ่านบทสรุปได้ครับ");
       }
       return;
    }

    // If still generating, just wait (UI shows spinner)
    if (isGeneratingAudio) return;

    // If missing buffer but not generating, try again
    if (!masterAudioBufferRef.current && state.result?.summary) {
        generateAudioInBackground(state.result.summary, selectedVoice);
        return;
    }

    if (masterAudioBufferRef.current) {
        stopAudio();
        const source = ctx.createBufferSource();
        source.buffer = masterAudioBufferRef.current;
        source.connect(ctx.destination);
        source.onended = () => setIsAudioPlaying(false);
        source.start();
        audioSourceRef.current = source;
        setIsAudioPlaying(true);
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
      audioSourceRef.current = null;
    }
    setIsAudioPlaying(false);
  };

  const handleVoiceChange = async (voice: string) => {
    setSelectedVoice(voice);
    stopAudio();
    masterAudioBufferRef.current = null;
    if (state.result?.summary) {
        generateAudioInBackground(state.result.summary, voice);
    }
  };

  const reset = () => {
    stopAudio();
    setState({ status: AppStatus.IDLE, result: null, error: null, progressMessage: '' });
    setSelectedFiles([]);
    masterAudioBufferRef.current = null;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12 flex flex-col min-h-screen transition-colors duration-500 relative">
      
      {/* Dark Mode Toggle with Animation - FRAMELESS & GLOWING */}
      <button 
        onClick={() => setIsDarkMode(!isDarkMode)} 
        className="fixed top-6 right-6 z-50 p-2 transition-transform duration-500 hover:scale-110 active:scale-95 focus:outline-none"
        aria-label="Toggle Dark Mode"
      >
        <div className="relative w-20 h-20 flex items-center justify-center">
          {/* Moon Icon */}
          <span 
            className={`absolute inset-0 text-6xl md:text-7xl flex items-center justify-center transform transition-all duration-700 ease-in-out ${
               isDarkMode 
                 ? 'rotate-0 opacity-100 scale-100 drop-shadow-[0_0_20px_rgba(255,255,255,0.8)]' 
                 : 'rotate-180 opacity-0 scale-50'
            }`}
          >
            🌙
          </span>
          
          {/* Sun Icon */}
          <span 
             className={`absolute inset-0 text-6xl md:text-7xl flex items-center justify-center transform transition-all duration-700 ease-in-out ${
               !isDarkMode 
                 ? 'rotate-0 opacity-100 scale-100 drop-shadow-[0_0_25px_rgba(253,186,116,1)]' 
                 : '-rotate-180 opacity-0 scale-50'
             }`}
          >
            ☀️
          </span>
        </div>
      </button>

      <Header />
      
      {/* Changed justify-center to justify-start and reduced margins to pull content up */}
      <main className="flex-grow flex flex-col items-center justify-start space-y-4 mt-2">
        {state.status === AppStatus.IDLE && (
          <div className="w-full animate-fade-in">
            {selectedFiles.length === 0 ? (
              <>
                {/* Reduced margin from mb-4 to mb-2 */}
                <div className="text-center mb-2">
                  <h2 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-blue-500 mb-1 py-2 leading-normal">เริ่มสร้างเรื่องเล่าจากเอกสาร</h2>
                  <p className="text-gray-600 dark:text-gray-300">อัปโหลดรูปภาพ หรือ PDF เอกสารภาษาไทยของคุณที่นี่</p>
                </div>
                <FileUploader onUpload={handleFileSelection} />
              </>
            ) : (
              <div className="w-full">
                <div className="flex justify-between items-center mb-6">
                   <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">เอกสารที่เลือก ({selectedFiles.length})</h2>
                   <button onClick={() => setSelectedFiles([])} className="text-red-500 font-semibold">ล้างทั้งหมด</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {filePreviews.map((url, index) => (
                    <div key={index} className="aspect-[3/4] bg-gray-100 dark:bg-slate-700 rounded-xl overflow-hidden shadow-md relative">
                       <img src={url} className="w-full h-full object-cover" />
                       <button onClick={() => removeFile(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center mt-8">
                  <button onClick={handleStartProcessing} className="bg-gradient-to-r from-green-600 to-teal-600 text-white text-xl font-bold py-4 px-12 rounded-full shadow-xl hover:scale-105 transition">
                    ⚡ วิเคราะห์และสร้างเสียง
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {state.status !== AppStatus.IDLE && state.status !== AppStatus.COMPLETED && state.status !== AppStatus.ERROR && (
          <ProcessingOverlay 
             status={state.status} 
             message={state.progressMessage} 
             onCancel={handleCancel}
          />
        )}

        {state.status === AppStatus.COMPLETED && state.result && (
          <ResultView 
            result={state.result} 
            isPlaying={isAudioPlaying}
            isGenerating={isGeneratingAudio}
            onPlay={handlePlay} 
            onStop={stopAudio}
            onReset={reset}
            selectedVoice={selectedVoice}
            onVoiceChange={handleVoiceChange}
          />
        )}

        {state.status === AppStatus.ERROR && (
          <div className="bg-red-50 p-8 rounded-3xl text-center shadow-lg">
            <h3 className="text-xl font-bold text-red-800 mb-2">เกิดข้อผิดพลาด</h3>
            <p className="text-red-600 mb-6">{state.error}</p>
            <button onClick={reset} className="bg-red-600 text-white font-bold py-3 px-8 rounded-full">ลองใหม่</button>
          </div>
        )}
      </main>

    </div>
  );
};

export default App;
