
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
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          if (!context) {
             reject(new Error("No Canvas context"));
             return;
          }
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
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
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  };

  // --- CORE FUNCTION: Prepare Full Audio Buffer ---
  const prepareFullAudio = async (text: string, voice: string) => {
    const ctx = getAudioContext();
    const chunks = splitTextSimple(text);
    const audioBuffers: AudioBuffer[] = [];

    // Process chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      // FIX: Add delay to respect Gemini Free Tier Rate Limits (RPM)
      // Wait 3 seconds between chunks (except the first one) to prevent 429 Errors
      if (i > 0) {
        await new Promise(r => setTimeout(r, 3000));
      }

      try {
        const b64 = await generateNaturalSpeech(chunks[i], voice);
        const buffer = pcmToAudioBuffer(base64ToBytes(b64), ctx);
        audioBuffers.push(buffer);
      } catch (e: any) {
        console.warn("Audio chunk failed, initiating retry:", e);
        
        // Retry logic for 429 (Rate Limit)
        if (e.message.includes('429') || e.message.includes('ระบบกำลังทำงานหนัก') || e.message.includes('quota')) {
            console.log("Hit rate limit. Waiting 6s before retry...");
            await new Promise(r => setTimeout(r, 6000)); // Wait longer (6s)
            
            try {
                // Retry once
                const b64 = await generateNaturalSpeech(chunks[i], voice);
                const buffer = pcmToAudioBuffer(base64ToBytes(b64), ctx);
                audioBuffers.push(buffer);
            } catch (retryErr) {
                console.error("Retry failed:", retryErr);
                throw retryErr; // Fail if retry also fails
            }
        } else {
             throw e; // Propagate other errors immediately
        }
      }
    }

    if (audioBuffers.length === 0) return null;

    // Merge all buffers into one
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

    try {
      stopAudio();
      masterAudioBufferRef.current = null;

      const fileCount = selectedFiles.length;
      setState(prev => ({ ...prev, status: AppStatus.UPLOADING, progressMessage: `กำลังแปลงไฟล์ ${fileCount} รายการ...` }));
      
      const filesData = await Promise.all(selectedFiles.map(compressFile));

      setState(prev => ({ ...prev, status: AppStatus.PROCESSING_OCR, progressMessage: `กำลังอ่านและสรุปใจความ...` }));
      const { original, summary } = await performOCRAndSummarize(filesData);

      // === GENERATE AUDIO IMMEDIATELY (Soft Fail) ===
      setState(prev => ({ ...prev, status: AppStatus.GENERATING_VOICE, progressMessage: `กำลังสร้างเสียงบรรยาย... (อาจใช้เวลาสักครู่)` }));
      
      let isAudioUnavailable = false;
      try {
        const fullBuffer = await prepareFullAudio(summary, selectedVoice);
        masterAudioBufferRef.current = fullBuffer;
      } catch (audioErr) {
        console.error("Audio generation skipped due to quota:", audioErr);
        isAudioUnavailable = true;
      }

      setState(prev => ({ ...prev, status: AppStatus.FINISHING, progressMessage: 'เสร็จเรียบร้อย! พร้อมเล่น' }));
      // Small UI pause for transition effect only
      await new Promise(r => setTimeout(r, 500)); 

      setState({
        status: AppStatus.COMPLETED,
        result: { 
          originalText: original, 
          summary: summary,
          isAudioUnavailable: isAudioUnavailable
        },
        error: null,
        progressMessage: 'เรียบร้อยแล้ว!'
      });

    } catch (err: any) {
      console.error(err);
      setState(prev => ({ ...prev, status: AppStatus.ERROR, error: err.message || 'เกิดข้อผิดพลาดในการประมวลผล' }));
    }
  };

  const handlePlay = async () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    // Check if unavailable flag is set
    if (state.result?.isAudioUnavailable) {
       alert("ขออภัย: โควต้าสร้างเสียงเต็มในขณะนี้ (Quota Exceeded)\nคุณสามารถอ่านบทสรุปได้ และลองกดสร้างเสียงใหม่ภายหลัง");
       return;
    }

    // If we don't have the buffer (maybe switched voice), try regenerate
    if (!masterAudioBufferRef.current && state.result?.summary) {
        try {
            setIsGeneratingAudio(true);
            const buffer = await prepareFullAudio(state.result.summary, selectedVoice);
            masterAudioBufferRef.current = buffer;
        } catch (e: any) {
            setIsGeneratingAudio(false);
            alert("ไม่สามารถสร้างเสียงได้เนื่องจากโควต้าเต็ม (429)\nกรุณารอสักครู่ (1-2 นาที) แล้วลองใหม่");
            return;
        }
        setIsGeneratingAudio(false);
    }

    if (masterAudioBufferRef.current) {
        stopAudio(); // Ensure clean slate
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
    // Invalidate buffer so it regenerates on next play
    masterAudioBufferRef.current = null;
  };

  const reset = () => {
    stopAudio();
    setState({ status: AppStatus.IDLE, result: null, error: null, progressMessage: '' });
    setSelectedFiles([]);
    masterAudioBufferRef.current = null;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12 flex flex-col min-h-screen transition-colors duration-500 relative">
      
      {/* Dark Mode Toggle - Top Right Celestial Body */}
      <button 
        onClick={() => setIsDarkMode(!isDarkMode)} 
        className="fixed top-4 right-4 md:top-6 md:right-6 z-50 p-2 rounded-full focus:outline-none group"
        aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        <div className="relative w-16 h-16 md:w-20 md:h-20 transition-transform duration-700 hover:scale-110 active:scale-90">
             {/* Sun Icon */}
             <div className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ease-in-out transform ${isDarkMode ? 'opacity-0 rotate-180 scale-50' : 'opacity-100 rotate-0 scale-100'}`}>
                <span className="text-5xl md:text-7xl filter drop-shadow-[0_0_15px_rgba(251,191,36,0.8)] cursor-pointer">☀️</span>
             </div>
             
             {/* Moon Icon */}
             <div className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ease-in-out transform ${isDarkMode ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-180 scale-50'}`}>
                <span className="text-4xl md:text-6xl filter drop-shadow-[0_0_15px_rgba(255,255,255,0.6)] cursor-pointer">🌙</span>
             </div>
        </div>
      </button>

      <Header />
      
      <main className="flex-grow flex flex-col items-center justify-center space-y-8 mt-12">
        {state.status === AppStatus.IDLE && (
          <div className="w-full animate-fade-in">
            {selectedFiles.length === 0 ? (
              <>
                <div className="text-center mb-10">
                  <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-blue-500 mb-2">เริ่มสร้างเรื่องเล่าจากเอกสาร</h2>
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
          <ProcessingOverlay status={state.status} message={state.progressMessage} />
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
