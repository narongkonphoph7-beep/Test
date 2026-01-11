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

// === SMART SPLITTER ===
// Chunk 0 is kept smaller for instant playback
const splitTextSmart = (text: string): string[] => {
  const chunks: string[] = [];
  const sentences = text.split(/([\n.!?]+)/);
  
  let currentChunk = "";
  // First chunk limit: 300 chars (Fast load)
  // Subsequent chunks: 800 chars (Efficient batching)
  let currentLimit = 300; 

  for (const s of sentences) {
    if ((currentChunk.length + s.length) > currentLimit && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = s;
      currentLimit = 800; // Increase limit for subsequent chunks
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
  const [isFirstChunkReady, setIsFirstChunkReady] = useState(false); // New flag for instant UI enable
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck'); 
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(0);

  // Audio Engine Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Queue System: Map<ChunkIndex, AudioBuffer>
  const audioQueueRef = useRef<Map<number, AudioBuffer>>(new Map());
  const totalChunksRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  // Cancellation Refs
  const mainProcessAbortControllerRef = useRef<AbortController | null>(null);
  const audioProcessAbortControllerRef = useRef<AbortController | null>(null);

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  useEffect(() => {
    const urls = selectedFiles.map(file => URL.createObjectURL(file));
    setFilePreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [selectedFiles]);

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
          if (!window.pdfjsLib) { reject(new Error("PDF Lib not loaded.")); return; }
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.0 }); 
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) { reject(new Error("No Canvas context")); return; }
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); 
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        } catch (error) { reject(new Error("Cannot read PDF")); }
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
          const MAX_WIDTH = 768; 
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  };

  const isRetryableError = (e: any) => {
    const msg = (e.message || '').toLowerCase();
    return msg.includes('429') || msg.includes('503') || msg.includes('504') || msg.includes('timeout');
  };

  // --- NEW AUDIO ENGINE: SEQUENTIAL CHUNK LOADING ---
  const startSmartAudioGeneration = async (text: string, voice: string) => {
    // 1. Reset Audio State
    stopAudio();
    audioQueueRef.current.clear();
    setIsFirstChunkReady(false);
    
    // 2. Setup Cancellation
    if (audioProcessAbortControllerRef.current) audioProcessAbortControllerRef.current.abort();
    audioProcessAbortControllerRef.current = new AbortController();
    const signal = audioProcessAbortControllerRef.current.signal;

    // 3. Prepare chunks
    const chunks = splitSmartSmart(text);
    totalChunksRef.current = chunks.length;

    const ctx = getAudioContext();

    // 4. FETCH FIRST CHUNK (High Priority)
    try {
      const b64_0 = await generateNaturalSpeech(chunks[0], voice, signal);
      if (signal.aborted) return;
      
      const buffer_0 = pcmToAudioBuffer(base64ToBytes(b64_0), ctx);
      audioQueueRef.current.set(0, buffer_0);
      
      // *** MAGIC MOMENT: Enable Play button immediately after 1st chunk ***
      setIsFirstChunkReady(true); 
    } catch (e: any) {
        if (e.name !== 'AbortError') {
             console.error("First chunk failed", e);
             setState(prev => prev.result ? ({...prev, result: {...prev.result, isAudioUnavailable: true}}) : prev);
        }
        return;
    }

    // 5. FETCH REMAINING CHUNKS (Background Parallel)
    // We limit concurrency to 2 to avoid flooding bandwidth while playing
    const remainingChunks = chunks.map((c, i) => ({ text: c, index: i })).slice(1);
    
    // Process remaining in batches of 2
    const batchSize = 2;
    for (let i = 0; i < remainingChunks.length; i += batchSize) {
        if (signal.aborted) break;
        const batch = remainingChunks.slice(i, i + batchSize);
        await Promise.all(batch.map(async (item) => {
            try {
                if (signal.aborted) return;
                const b64 = await generateNaturalSpeech(item.text, voice, signal);
                const buffer = pcmToAudioBuffer(base64ToBytes(b64), ctx);
                audioQueueRef.current.set(item.index, buffer);
            } catch (e) {
                console.warn(`Chunk ${item.index} failed`, e);
            }
        }));
    }
  };

  // Renamed helper to match usage above
  const splitSmartSmart = (text: string) => splitTextSmart(text);

  const handleStartProcessing = async () => {
    if (selectedFiles.length === 0) return;
    mainProcessAbortControllerRef.current = new AbortController();

    try {
      stopAudio();
      setState(prev => ({ ...prev, status: AppStatus.UPLOADING, progressMessage: `กำลังแปลงไฟล์ ${selectedFiles.length} รายการ...` }));
      const filesData = await Promise.all(selectedFiles.map(compressFile));

      if (mainProcessAbortControllerRef.current.signal.aborted) return;
      setState(prev => ({ ...prev, status: AppStatus.PROCESSING_OCR, progressMessage: `กำลังอ่านและสรุปใจความ...` }));
      
      const summaryData = await performOCRAndSummarize(filesData, mainProcessAbortControllerRef.current.signal);
      
      // === SHOW RESULT IMMEDIATELY ===
      setState({
        status: AppStatus.COMPLETED,
        result: { 
          originalText: summaryData.original, 
          summary: summaryData.summary,
          isAudioUnavailable: false
        },
        error: null,
        progressMessage: 'เรียบร้อยแล้ว!'
      });

      // === START AUDIO INSTANTLY ===
      startSmartAudioGeneration(summaryData.summary, selectedVoice);

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setState(prev => ({ ...prev, status: AppStatus.ERROR, error: err.message || 'เกิดข้อผิดพลาดในการประมวลผล' }));
    }
  };
  
  const handleCancel = () => {
      if (mainProcessAbortControllerRef.current) mainProcessAbortControllerRef.current.abort();
      if (audioProcessAbortControllerRef.current) audioProcessAbortControllerRef.current.abort();
      stopAudio();
      setIsFirstChunkReady(false);
      setState({ status: AppStatus.IDLE, result: null, error: null, progressMessage: '' });
  };

  // === SEQUENTIAL PLAYBACK ENGINE ===
  const playSequence = async (index: number) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    // 1. Check if buffer exists
    const buffer = audioQueueRef.current.get(index);

    if (!buffer) {
        // If buffer isn't ready but we expect more chunks
        if (index < totalChunksRef.current) {
            // Buffer Underflow: Wait a bit and retry (Simple buffering logic)
            console.log(`Buffering chunk ${index}...`);
            setTimeout(() => {
                if (isPlayingRef.current) playSequence(index);
            }, 500); 
            return;
        } else {
            // End of playback
            setIsAudioPlaying(false);
            isPlayingRef.current = false;
            setCurrentPlayingIndex(0);
            return;
        }
    }

    // 2. Play Buffer
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    source.onended = () => {
        if (isPlayingRef.current) {
            playSequence(index + 1);
        }
    };

    source.start();
    audioSourceRef.current = source;
    setCurrentPlayingIndex(index);
    isPlayingRef.current = true;
    setIsAudioPlaying(true);
  };

  const handlePlay = () => {
    if (state.result?.isAudioUnavailable) {
       startSmartAudioGeneration(state.result.summary, selectedVoice);
       return;
    }

    if (isPlayingRef.current) return; // Already playing

    // Start from beginning or resume logic (simplified to start from 0 for now)
    playSequence(0);
  };

  const stopAudio = () => {
    isPlayingRef.current = false;
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
      audioSourceRef.current = null;
    }
    setIsAudioPlaying(false);
    setCurrentPlayingIndex(0);
  };

  const handleVoiceChange = (voice: string) => {
    setSelectedVoice(voice);
    if (state.result?.summary) {
        startSmartAudioGeneration(state.result.summary, voice);
    }
  };

  const reset = () => {
    handleCancel();
    setSelectedFiles([]);
  };

  const handleFileSelection = (files: File[]) => {
    setSelectedFiles(files);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12 flex flex-col min-h-screen transition-colors duration-500 relative">
      
      {/* Dark Mode Toggle */}
      <button 
        onClick={() => setIsDarkMode(!isDarkMode)} 
        className="fixed top-6 right-6 z-50 p-2 transition-transform duration-500 hover:scale-110 active:scale-95 focus:outline-none"
      >
        <div className="relative w-20 h-20 flex items-center justify-center">
          <span className={`absolute inset-0 text-6xl md:text-7xl flex items-center justify-center transform transition-all duration-700 ease-in-out ${isDarkMode ? 'rotate-0 opacity-100' : 'rotate-180 opacity-0'}`}>🌙</span>
          <span className={`absolute inset-0 text-6xl md:text-7xl flex items-center justify-center transform transition-all duration-700 ease-in-out ${!isDarkMode ? 'rotate-0 opacity-100' : '-rotate-180 opacity-0'}`}>☀️</span>
        </div>
      </button>

      <Header />
      
      <main className="flex-grow flex flex-col items-center justify-start space-y-4 mt-2">
        {state.status === AppStatus.IDLE && (
          <div className="w-full animate-fade-in">
            {selectedFiles.length === 0 ? (
              <>
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
                       <button onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== index))} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1">✕</button>
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
          <ProcessingOverlay status={state.status} message={state.progressMessage} onCancel={handleCancel} />
        )}

        {state.status === AppStatus.COMPLETED && state.result && (
          <ResultView 
            result={state.result} 
            isPlaying={isAudioPlaying}
            // Logic change: 'isGenerating' in UI now means "Is the FIRST chunk still loading?"
            // If first chunk is ready, we stop showing the spinner so user can click Play.
            isGenerating={!isFirstChunkReady && !state.result.isAudioUnavailable}
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