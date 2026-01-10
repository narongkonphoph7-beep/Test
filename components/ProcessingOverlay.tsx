
import React, { useEffect, useState } from 'react';
import { AppStatus } from '../types';

interface ProcessingOverlayProps {
  status: AppStatus;
  message: string;
  onCancel?: () => void;
}

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ status, message, onCancel }) => {
  const [progress, setProgress] = useState(5);
  
  // Detect if we are in a "Waiting/Retry" state based on the message content
  const isWaiting = message.includes('รอ') || message.includes('⏳') || message.includes('ลองใหม่');

  // 1. Handle Status Jumps (Base starting points)
  useEffect(() => {
    let target = 5;
    switch (status) {
      case AppStatus.UPLOADING: target = 10; break;
      case AppStatus.PROCESSING_OCR: target = 25; break; // Start lower
      case AppStatus.SUMMARIZING: target = 60; break;
      case AppStatus.GENERATING_VOICE: target = 85; break; 
      case AppStatus.FINISHING: target = 90; break; 
      case AppStatus.COMPLETED: target = 100; break;
      default: target = 5;
    }
    // Only set if current is lower
    setProgress(prev => Math.max(prev, target));
  }, [status]);

  // 2. Auto-Increment (Fake Progress) with Stricter CAPS
  useEffect(() => {
    if (status === AppStatus.COMPLETED) {
        setProgress(100);
        return;
    }

    if (isWaiting) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        // Define hard caps per stage to prevent "Hanging at 98%" sensation
        let cap = 95;
        if (status === AppStatus.UPLOADING) cap = 20;       
        else if (status === AppStatus.PROCESSING_OCR) cap = 80; // Hold at 80 for OCR
        else if (status === AppStatus.SUMMARIZING) cap = 85;
        else if (status === AppStatus.GENERATING_VOICE) cap = 95;

        if (prev >= cap) return prev;
        
        // Very slow increment if above 70% to manage expectations
        const increment = prev < 60 ? 0.5 : 0.05; 
        return Math.min(prev + increment, cap);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [status, isWaiting]);

  return (
    <div className="w-full max-w-lg bg-white dark:bg-slate-800 p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center space-y-8 border border-blue-50 dark:border-slate-700 transition-all duration-300">
      
      {/* Circular Loader Area */}
      <div className="relative w-32 h-32 flex items-center justify-center">
        {/* Spinner Ring Background */}
        <div className="absolute inset-0 border-[6px] border-blue-100 dark:border-slate-600 rounded-full"></div>
        {/* Active Spinner Ring */}
        <div className={`
           absolute inset-0 border-[6px] rounded-full border-t-transparent transition-all duration-500
           ${isWaiting ? 'border-amber-500 rotate-0' : 'border-blue-600 dark:border-blue-500 animate-spin'}
           ${progress >= 100 ? 'border-green-500 rotate-0' : ''}
        `}></div>
        
        {/* Center Icon */}
        <div className="relative z-10 bg-white dark:bg-slate-800 rounded-full p-2 shadow-sm overflow-hidden">
           <img 
             src="https://api.dicebear.com/7.x/bottts/svg?seed=ThaiSight" 
             alt="Loading" 
             className={`w-16 h-16 transform transition-transform object-cover ${progress >= 100 ? 'scale-110' : ''}`}
           />
        </div>
      </div>
      
      {/* Text Area */}
      <div className="text-center space-y-3">
        <h3 className={`text-3xl font-black tracking-tight ${isWaiting ? 'text-amber-500' : 'text-gray-800 dark:text-white'}`}>
          {progress >= 100 ? 'เสร็จเรียบร้อย!' : isWaiting ? 'กำลังรอคิว...' : 'กำลังทำงาน...'}
        </h3>
        <p className={`font-medium text-lg animate-pulse ${isWaiting ? 'text-amber-600' : 'text-blue-600 dark:text-blue-400'}`}>
           {message}
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 font-mono">
           {progress.toFixed(0)}%
        </p>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full relative mt-8 px-2">
        <div className="w-full bg-gray-100 dark:bg-slate-700 h-4 rounded-full overflow-hidden relative shadow-inner">
           {/* Filled Bar */}
           <div 
             className={`h-full rounded-full transition-all duration-[200ms] ease-linear shadow-[0_0_15px_rgba(37,99,235,0.4)]
               ${isWaiting ? 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-gradient-to-r from-blue-400 to-blue-600 dark:from-blue-500 dark:to-blue-400'}
             `}
             style={{ width: `${progress}%` }}
           >
           </div>
        </div>
      </div>
      
      <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-6 text-center">
        {isWaiting ? "ระบบกำลังจัดสรรทรัพยากร กรุณารอสักครู่..." : "ใช้โหมดความเร็วสูง (Flash Lite) เพื่อลดเวลารอ..."}
      </p>

      {/* Cancel Button */}
      {onCancel && (
        <button 
          onClick={onCancel}
          className="mt-4 text-red-500 hover:text-red-700 font-semibold text-sm underline underline-offset-4"
        >
          ยกเลิกการทำงาน
        </button>
      )}
    </div>
  );
};
