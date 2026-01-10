
import React, { useEffect, useState } from 'react';
import { AppStatus } from '../types';

interface ProcessingOverlayProps {
  status: AppStatus;
  message: string;
}

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ status, message }) => {
  const [progress, setProgress] = useState(5);

  useEffect(() => {
    // Determine target progress based on status with a more natural progression
    let target = 5;
    switch (status) {
      case AppStatus.UPLOADING: target = 15; break;
      case AppStatus.PROCESSING_OCR: target = 45; break;
      case AppStatus.SUMMARIZING: target = 80; break;
      case AppStatus.GENERATING_VOICE: target = 95; break;
      case AppStatus.FINISHING: target = 100; break; // Ensure full bar at finishing state
      case AppStatus.COMPLETED: target = 100; break;
      default: target = 5;
    }
    
    // Smoothly update progress
    const timer = setTimeout(() => setProgress(target), 100);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <div className="w-full max-w-lg bg-white dark:bg-slate-800 p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center space-y-8 border border-blue-50 dark:border-slate-700 transition-all duration-300">
      
      {/* Circular Loader Area */}
      <div className="relative w-32 h-32 flex items-center justify-center">
        {/* Spinner Ring Background */}
        <div className="absolute inset-0 border-[6px] border-blue-100 dark:border-slate-600 rounded-full"></div>
        {/* Active Spinner Ring - Stop animation when 100% */}
        <div className={`absolute inset-0 border-[6px] border-blue-600 dark:border-blue-500 rounded-full border-t-transparent ${progress === 100 ? '' : 'animate-spin'}`}></div>
        
        {/* Center Icon - Updated to the 3D Robot Image */}
        <div className="relative z-10 bg-white dark:bg-slate-800 rounded-full p-2 shadow-sm overflow-hidden">
           <img 
             src="https://api.dicebear.com/7.x/bottts/svg?seed=ThaiSight" 
             alt="Loading" 
             className={`w-16 h-16 transform transition-transform object-cover ${progress === 100 ? 'scale-110' : ''}`}
           />
        </div>
      </div>
      
      {/* Text Area */}
      <div className="text-center space-y-3">
        <h3 className="text-3xl font-black text-gray-800 dark:text-white tracking-tight">
          {progress === 100 ? 'เสร็จเรียบร้อย!' : 'กำลังทำงาน...'}
        </h3>
        <p className="text-blue-600 dark:text-blue-400 font-medium text-lg animate-pulse">{message}</p>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full relative mt-8 px-2">
        <div className="w-full bg-gray-100 dark:bg-slate-700 h-4 rounded-full overflow-hidden relative shadow-inner">
           {/* Filled Bar */}
           <div 
             className="h-full bg-gradient-to-r from-blue-400 to-blue-600 dark:from-blue-500 dark:to-blue-400 rounded-full transition-all duration-[1000ms] ease-out shadow-[0_0_15px_rgba(37,99,235,0.4)]"
             style={{ width: `${progress}%` }}
           >
           </div>
        </div>
      </div>
      
      <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-6 text-center">
        "ความพยายามในการอ่านเอกสารอย่างละเอียดเพื่อผลลัพธ์ที่แม่นยำที่สุด..."
      </p>
    </div>
  );
};
