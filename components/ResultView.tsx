
import React, { useState } from 'react';
import { ProcessingResult } from '../types';

interface ResultViewProps {
  result: ProcessingResult;
  isPlaying: boolean;
  isGenerating: boolean;
  onPlay: () => void;
  onStop: () => void;
  onReset: () => void;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  playbackProgress?: { current: number; total: number };
}

// Updated Voice List: Replaced Zephyr with Aoede to ensure correct Female voice generation
const VOICES = [
  { id: 'Puck', name: 'Puck (ชาย - นุ่มนวล)', gender: 'Male' },
  { id: 'Charon', name: 'Charon (ชาย - เสียงทุ้มลึก)', gender: 'Male' },
  { id: 'Kore', name: 'Kore (หญิง - ผ่อนคลาย)', gender: 'Female' },
  { id: 'Fenrir', name: 'Fenrir (ชาย - ดุดัน)', gender: 'Male' },
  { id: 'Aoede', name: 'Aoede (หญิง - ทางการ)', gender: 'Female' }, 
];

export const ResultView: React.FC<ResultViewProps> = ({ 
  result, 
  isPlaying, 
  isGenerating,
  onPlay, 
  onStop, 
  onReset,
  selectedVoice,
  onVoiceChange,
  playbackProgress
}) => {
  const [tab, setTab] = useState<'summary' | 'original'>('summary');
  const [copied, setCopied] = useState(false);
  
  const currentVoiceData = VOICES.find(v => v.id === selectedVoice);

  const handleCopy = () => {
    navigator.clipboard.writeText(result.originalText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-white/95 backdrop-blur-2xl dark:bg-slate-900/95 rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50 dark:border-slate-700 flex flex-col animate-fade-in transition-all duration-300">
      {/* Top Header - Audio Call to Action */}
      <div className={`
         p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 transition-colors
         ${result.isAudioUnavailable 
             ? 'bg-gradient-to-r from-orange-400 to-red-500' 
             : 'bg-gradient-to-r from-pink-300 to-blue-300 dark:from-pink-900 dark:to-blue-900'}
      `}>
        <div className="flex items-center space-x-6">
          <div className="bg-white/20 p-4 rounded-full backdrop-blur-sm animate-pulse">
            <span className="text-4xl">{result.isAudioUnavailable ? '🔇' : '✨'}</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-1 flex flex-wrap items-center gap-2">
              <span>{result.isAudioUnavailable ? 'สร้างเสียงไม่สำเร็จ' : 'เสียงระดับสตูดิโอ'}</span>
              {!result.isAudioUnavailable && (
                  <span className="bg-white/20 px-3 py-0.5 rounded-full text-sm font-medium backdrop-blur-md border border-white/10">
                     🎙️ {currentVoiceData?.name || selectedVoice}
                  </span>
              )}
            </h2>
            <div className="text-blue-50 dark:text-blue-100 opacity-90 flex items-center space-x-2">
              {result.isAudioUnavailable ? (
                <span className="font-medium text-sm md:text-base">โควต้าฟรีอาจเต็ม (แนะนำ: ใช้ API Key แบบ Paid)</span>
              ) : isPlaying ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <span>
                    กำลังเล่าเรื่อง...
                    {isGenerating && <span className="text-xs ml-2 opacity-70">(กำลังโหลดช่วงถัดไป...)</span>}
                  </span>
                </>
              ) : isGenerating ? (
                <span>กำลังเริ่มสร้างเสียงใหม่...</span>
              ) : (
                <span>กดฟังได้ทันที (พร้อมใช้งาน)</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex space-x-3">
          {result.isAudioUnavailable ? (
             <button 
                onClick={onPlay} 
                className="group flex items-center space-x-2 bg-white text-orange-600 font-bold py-3 px-6 rounded-full shadow-lg hover:bg-orange-50 transition"
             >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span>ลองสร้างเสียงใหม่</span>
             </button>
          ) : isPlaying ? (
            <button 
              onClick={onStop}
              className="group flex items-center space-x-3 bg-red-500 text-white font-bold py-4 px-10 rounded-full shadow-lg transition transform hover:scale-105 active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
              </svg>
              <span>หยุด</span>
            </button>
          ) : (
            <button 
              onClick={onPlay}
              disabled={isGenerating}
              className={`group flex items-center space-x-3 bg-white text-blue-600 font-bold py-4 px-10 rounded-full shadow-lg transition transform hover:scale-105 active:scale-95 ${isGenerating ? 'opacity-70 cursor-wait' : ''}`}
            >
              {isGenerating ? (
                <div className="w-6 h-6 border-2 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
              <span>{isGenerating ? 'กำลังโหลด...' : 'ฟังเสียงทันที'}</span>
            </button>
          )}
        </div>
      </div>

      {/* AI Voice Selector (Always enabled) */}
      <div className={`
         bg-violet-50/50 dark:bg-slate-800/50 px-8 py-6 border-b border-violet-100 dark:border-slate-700
         ${result.isAudioUnavailable ? 'opacity-50 pointer-events-none grayscale' : ''}
      `}>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-3">
            เลือกนักพากย์ AI (Gemini Voices)
        </label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {VOICES.map((voice) => (
                <button
                    key={voice.id}
                    onClick={() => {
                        // Allow clicking even if generating, but not if playing current
                        if (selectedVoice !== voice.id) {
                            onVoiceChange(voice.id);
                        }
                    }}
                    disabled={false} 
                    className={`
                        relative py-3 px-2 rounded-xl border text-sm font-medium transition-all
                        flex flex-col items-center justify-center gap-1 backdrop-blur-sm
                        ${selectedVoice === voice.id 
                            ? 'bg-violet-600 border-violet-600 text-white shadow-md scale-105 ring-2 ring-violet-200 dark:ring-violet-900' 
                            : 'bg-white/80 dark:bg-slate-700/80 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-200 hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-slate-600'}
                    `}
                >
                    <span className="text-xl">{voice.gender === 'Male' ? '👨' : '👩'}</span>
                    <span className="truncate w-full text-center">{voice.name}</span>
                </button>
            ))}
        </div>
      </div>

      {/* Modern Tab Switcher */}
      <div className="px-6 pt-6 pb-2 bg-gradient-to-b from-white to-gray-50 dark:from-slate-900 dark:to-slate-800/50">
        <div className="bg-gray-200/50 dark:bg-black/20 p-1.5 rounded-2xl flex relative shadow-inner">
           {/* Animated Background Pill */}
           <div 
             className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-white dark:bg-slate-700 rounded-xl shadow-sm transition-all duration-300 ease-out ${
               tab === 'summary' ? 'translate-x-0' : 'translate-x-[calc(100%+6px)]'
             }`}
           />
           
           <button
             onClick={() => setTab('summary')}
             className={`flex-1 relative z-10 py-3 px-4 rounded-xl text-sm md:text-base font-bold transition-all duration-300 flex items-center justify-center gap-2 ${
                tab === 'summary' 
                  ? 'text-violet-600 dark:text-violet-300' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
             }`}
             role="tab"
             aria-selected={tab === 'summary'}
           >
             <span className="text-xl">✨</span>
             บทสรุป (Summary)
           </button>
           
           <button
             onClick={() => setTab('original')}
             className={`flex-1 relative z-10 py-3 px-4 rounded-xl text-sm md:text-base font-bold transition-all duration-300 flex items-center justify-center gap-2 ${
                tab === 'original' 
                  ? 'text-blue-600 dark:text-blue-300' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
             }`}
             role="tab"
             aria-selected={tab === 'original'}
           >
             <span className="text-xl">📄</span>
             ต้นฉบับ (Original)
           </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-8 md:p-12 min-h-[400px] bg-white dark:bg-slate-900 transition-colors duration-300">
        <div key={tab} className="animate-fade-in">
        {tab === 'summary' ? (
          <div className="prose prose-violet dark:prose-invert max-w-none text-gray-700 dark:text-gray-200 text-lg leading-relaxed whitespace-pre-wrap">
             <div className="text-3xl text-violet-300 dark:text-violet-500 mb-4">“</div>
             {result.summary}
             <div className="text-3xl text-violet-300 dark:text-violet-500 text-right mt-4">”</div>
          </div>
        ) : (
          <div className="flex flex-col h-[600px] md:h-[600px] border border-gray-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
             {/* Document Toolbar */}
             <div className="flex items-center justify-between px-6 py-4 bg-gray-50/80 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 z-10 backdrop-blur-sm">
                <div className="flex items-center space-x-3">
                   <div className="bg-blue-100 dark:bg-slate-700 p-2 rounded-lg text-blue-600 dark:text-blue-400">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
                     </svg>
                   </div>
                   <div>
                     <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">ข้อความที่ AI อ่านได้ (OCR)</span>
                     <span className="block text-xs text-slate-500 dark:text-slate-400">ข้อความดิบจากไฟล์ภาพต้นฉบับ</span>
                   </div>
                </div>
                <button 
                   onClick={handleCopy}
                   className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                     copied 
                     ? 'bg-green-100 text-green-700 border border-green-200' 
                     : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 hover:shadow-md'
                   }`}
                >
                   {copied ? (
                     <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>คัดลอกแล้ว</span>
                     </>
                   ) : (
                     <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>คัดลอกข้อความ</span>
                     </>
                   )}
                </button>
             </div>

             {/* Text Content Area */}
             <div className="flex-grow p-8 bg-[#fdfdfd] dark:bg-slate-900 overflow-y-auto custom-scrollbar">
                <div className="max-w-none text-slate-700 dark:text-slate-300 font-sans text-lg leading-loose whitespace-pre-wrap selection:bg-blue-100 selection:text-blue-800 dark:selection:bg-blue-900 dark:selection:text-blue-200">
                   {result.originalText || "ไม่มีข้อมูลข้อความต้นฉบับ"}
                </div>
             </div>
          </div>
        )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="p-8 border-t dark:border-slate-700 bg-gray-50/80 dark:bg-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-sm">
        <p className="text-gray-400 dark:text-gray-500 text-xs">
          เอกสารถูกประมวลผลด้วยโมเดล Gemini Vision และ Gemini Neural Audio (Smart Stream)
        </p>
        <button 
          onClick={onReset}
          className="text-gray-600 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400 font-semibold text-sm underline underline-offset-4"
        >
          กลับไปหน้าอัปโหลดเอกสารใหม่
        </button>
      </div>
    </div>
  );
};
