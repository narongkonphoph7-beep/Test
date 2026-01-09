
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

// === OPTIMIZED CHUNKING ===
const splitTextIntoOptimizedChunks = (text: string): string[] => {
  let rawSegments: string[] = [];

  // 1. Initial Split (Sentence level)
  if (Intl && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter('th', { granularity: 'sentence' });
    rawSegments = Array.from(segmenter.segment(text)).map((s: any) => s.segment);
  } else {
    rawSegments = text.split(/[\n\r]+|(?<=[.!?])\s+/);
  }

  const optimizedChunks: string[] = [];
  let currentChunk = "";

  for (const segment of rawSegments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    if (!/[ก-๙a-zA-Z0-9]/.test(trimmed)) continue;

    const currentIndex = optimizedChunks.length;
    let limit = 500; 
    if (currentIndex === 0) limit = 100;      
    else if (currentIndex === 1) limit = 300; 

    if ((currentChunk.length + trimmed.length) < limit) {
      currentChunk += " " + trimmed;
    } else {
      if (currentChunk.trim()) optimizedChunks.push(currentChunk.trim());
      currentChunk = trimmed;
    }
  }
  if (currentChunk.trim()) optimizedChunks.push(currentChunk.trim());

  return optimizedChunks;
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
  const [playbackProgress, setPlaybackProgress] = useState({ current: 0, total: 0 });
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck'); 
  
  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isPlayingRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  
  // CACHE SYSTEM: Stores promises of AudioBuffers
  const audioCacheRef = useRef<Map<number, Promise<AudioBuffer | null>>>(new Map());

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

  // Helper to safely get or create AudioContext
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  // --- CORE FETCH LOGIC ---
  const fetchChunkData = async (text: string, voice: string, index: number, ctx: AudioContext): Promise<AudioBuffer | null> => {
    try {
       const audioBase64 = await generateNaturalSpeech(text, voice);
       const pcmBytes = base64ToBytes(audioBase64);
       return pcmToAudioBuffer(pcmBytes, ctx);
    } catch (e: any) {
       if (e.message.includes("SKIPPABLE_EMPTY_TEXT")) {
         console.warn(`Chunk ${index} skipped (empty content)`);
         return null;
       }
       console.error(`Chunk ${index} failed`, e);
       return null;
    }
  };

  // --- PREFETCH SYSTEM ---
  // Starts loading the first few chunks immediately, even before user clicks play.
  const startPrefetching = (text: string, voice: string) => {
    const ctx = getAudioContext();
    const chunks = splitTextIntoOptimizedChunks(text);
    
    // Clear old cache when starting new prefetch (e.g. voice changed or new summary)
    audioCacheRef.current.clear();

    const PREFETCH_LIMIT = 3; // Number of chunks to pre-load
    console.log(`🚀 Starting prefetch for ${Math.min(chunks.length, PREFETCH_LIMIT)} chunks (Voice: ${voice})`);

    for (let i = 0; i < Math.min(chunks.length, PREFETCH_LIMIT); i++) {
        const promise = fetchChunkData(chunks[i], voice, i, ctx);
        audioCacheRef.current.set(i, promise);
    }
  };

  const compressFile = async (file: File): Promise<FileData> => {
    if (file.type === 'application/pdf') {
      return new Promise(async (resolve, reject) => {
        try {
          if (!window.pdfjsLib) {
             reject(new Error("PDF Processing Library not loaded. Please refresh."));
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
             reject(new Error("Canvas context not available"));
             return;
          }
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        } catch (error) {
          console.error("PDF Conversion Error:", error);
          reject(new Error("ไม่สามารถอ่านไฟล์ PDF นี้ได้"));
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

  const handleStartProcessing = async () => {
    if (selectedFiles.length === 0) return;

    try {
      stopAudio();

      const fileCount = selectedFiles.length;
      setState(prev => ({ 
        ...prev, 
        status: AppStatus.UPLOADING, 
        progressMessage: `กำลังแปลงไฟล์ ${fileCount} รายการ...` 
      }));
      
      const filesData = await Promise.all(selectedFiles.map(compressFile));

      setState(prev => ({ ...prev, status: AppStatus.PROCESSING_OCR, progressMessage: `AI กำลังอ่านและสรุปใจความ (Vision Model)...` }));
      const { original, summary } = await performOCRAndSummarize(filesData);

      setState({
        status: AppStatus.COMPLETED,
        result: {
          originalText: original,
          summary: summary
        },
        error: null,
        progressMessage: 'เรียบร้อยแล้ว!'
      });

      // === TRIGGER PREFETCH IMMEDIATELY ===
      // This ensures audio is ready when user clicks play
      startPrefetching(summary, selectedVoice);

    } catch (err: any) {
      console.error(err);
      let errorMsg = err.message || 'เกิดข้อผิดพลาดบางอย่าง';
      setState(prev => ({ ...prev, status: AppStatus.ERROR, error: errorMsg }));
    }
  };

  const handleVoiceChange = (voice: string) => {
    setSelectedVoice(voice);
    // If we have a summary, start prefetching the new voice immediately
    if (state.result?.summary) {
        stopAudio();
        startPrefetching(state.result.summary, voice);
    }
  };

  const startStreamingPlayback = async () => {
    if (!state.result?.summary) return;

    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const chunks = splitTextIntoOptimizedChunks(state.result.summary);
    if (chunks.length === 0) return;

    stopAudio(); 
    setIsAudioPlaying(true);
    isPlayingRef.current = true;
    setPlaybackProgress({ current: 0, total: chunks.length });
    
    nextStartTimeRef.current = audioCtx.currentTime + 0.1;

    (async () => {
      for (let i = 0; i < chunks.length; i++) {
        if (!isPlayingRef.current) break;
        
        // --- CACHE & FETCH STRATEGY ---
        // 1. Check Cache first. If missing, start fetching.
        if (!audioCacheRef.current.has(i)) {
            const promise = fetchChunkData(chunks[i], selectedVoice, i, audioCtx);
            audioCacheRef.current.set(i, promise);
        }

        // 2. Lookahead: Trigger fetch for NEXT 2 chunks if not in cache
        for (let j = 1; j <= 2; j++) {
            const nextIdx = i + j;
            if (nextIdx < chunks.length && !audioCacheRef.current.has(nextIdx)) {
                const promise = fetchChunkData(chunks[nextIdx], selectedVoice, nextIdx, audioCtx);
                audioCacheRef.current.set(nextIdx, promise);
            }
        }

        // Update UI
        if (i === 0) setIsGeneratingAudio(true);
        setPlaybackProgress({ current: i + 1, total: chunks.length });

        try {
          // Await the promise from cache
          const buffer = await audioCacheRef.current.get(i);
          
          if (i === 0) setIsGeneratingAudio(false); 
          if (!isPlayingRef.current) break;
          if (!buffer) continue; 

          // Schedule Playback
          if (nextStartTimeRef.current < audioCtx.currentTime) {
             nextStartTimeRef.current = audioCtx.currentTime;
          }

          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          
          source.start(nextStartTimeRef.current);
          
          activeSourcesRef.current.push(source);
          
          source.onended = () => {
             const idx = activeSourcesRef.current.indexOf(source);
             if (idx > -1) activeSourcesRef.current.splice(idx, 1);
             
             if (i === chunks.length - 1 && activeSourcesRef.current.length === 0) {
                 setIsAudioPlaying(false);
                 isPlayingRef.current = false;
             }
          };

          nextStartTimeRef.current += buffer.duration;

        } catch (err) {
          console.error(`Error processing chunk ${i}`, err);
          setIsGeneratingAudio(false);
        }
      }
    })();
  };

  const stopAudio = () => {
    isPlayingRef.current = false;
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current = [];
    setIsAudioPlaying(false);
    setIsGeneratingAudio(false);
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
    audioCacheRef.current.clear(); // Clear cache on reset
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
                  <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-blue-500 mb-2">เริ่มสร้างเรื่องเล่าจากเอกสาร</h2>
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
                             <span className="text-3xl">📄</span>
                             <span className="text-sm font-bold mt-2">PDF</span>
                          </div>
                        ) : (
                          <img src={url} alt={`Preview ${index}`} className="w-full h-full object-cover" />
                        )}
                        <button 
                          onClick={() => removeFile(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
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
                    <span>วิเคราะห์ด้วย Gemini Vision</span>
                  </button>
                </div>
              </div>
            )}
            
            {selectedFiles.length === 0 && (
              <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">👁️</div>
                  <h3 className="font-semibold text-lg mb-2">Gemini Vision</h3>
                  <p className="text-sm text-gray-500">ใช้โมเดลล่าสุดอ่านภาพภาษาไทยได้คมชัดทุกตัวอักษร</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">🧠</div>
                  <h3 className="font-semibold text-lg mb-2">Smart Summary</h3>
                  <p className="text-sm text-gray-500">สรุปใจความสำคัญให้กระชับ เข้าใจง่าย</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition hover:shadow-md">
                  <div className="text-4xl mb-4">🎙️</div>
                  <h3 className="font-semibold text-lg mb-2">Instant Stream Voice</h3>
                  <p className="text-sm text-gray-500">ระบบสตรีมเสียงความเร็วสูง เล่นต่อเนื่องไม่มีสะดุด</p>
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
            isGenerating={isGeneratingAudio}
            onPlay={startStreamingPlayback} 
            onStop={stopAudio}
            onReset={reset}
            selectedVoice={selectedVoice}
            onVoiceChange={handleVoiceChange}
            playbackProgress={playbackProgress}
          />
        )}

        {state.status === AppStatus.ERROR && (
          <div className="bg-red-50 border border-red-200 p-8 rounded-3xl text-center max-w-md w-full shadow-lg">
            <h3 className="text-xl font-bold text-red-800 mb-2">เกิดข้อผิดพลาด</h3>
            <p className="text-red-600 mb-6">{state.error}</p>
            <button 
              onClick={reset}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full"
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
