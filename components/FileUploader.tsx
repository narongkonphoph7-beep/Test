import React, { useRef } from 'react';

interface FileUploaderProps {
  onUpload: (files: File[]) => void;
  compact?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onUpload, compact = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onUpload(filesArray);
      // Reset value so same files can be selected again if needed
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files).filter((file: File) => 
        file.type.startsWith('image/') || file.type === 'application/pdf'
      );
      
      if (filesArray.length > 0) {
        onUpload(filesArray);
      }
    }
  };

  if (compact) {
     return (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer border-2 border-dashed border-blue-300 dark:border-slate-500 bg-blue-50/50 dark:bg-slate-800/50 hover:bg-blue-100 dark:hover:bg-slate-700 hover:border-blue-500 dark:hover:border-slate-400 transition-all duration-300 rounded-2xl h-full w-full flex flex-col items-center justify-center p-4 text-center group"
        >
          <input 
            type="file" 
            accept="image/*,application/pdf" 
            multiple 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleChange}
          />
          <div className="bg-white dark:bg-slate-700 p-3 rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-sm text-blue-800 dark:text-blue-200 font-semibold group-hover:text-blue-600">เพิ่มรูป/PDF</span>
        </div>
     );
  }

  return (
    <div 
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative group w-full"
    >
      <input 
        type="file" 
        accept="image/*,application/pdf" 
        multiple 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleChange}
      />
      <div 
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer border-4 border-dashed border-blue-200 dark:border-slate-600 bg-white/60 backdrop-blur-md dark:bg-slate-900/60 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-300 rounded-[2.5rem] p-16 md:p-24 flex flex-col items-center justify-center space-y-8 shadow-xl hover:shadow-2xl min-h-[350px] md:min-h-[450px]"
      >
        <div className="bg-blue-600 p-8 rounded-full text-white shadow-lg group-hover:scale-110 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 md:h-20 md:w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="text-center space-y-2">
          <p className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-gray-100 drop-shadow-sm">คลิก หรือ ลากไฟล์รูป/PDF มาที่นี่</p>
          <p className="text-gray-600 dark:text-gray-300 text-lg font-medium">รองรับ JPG, PNG, WebP และ PDF</p>
        </div>
      </div>
    </div>
  );
};
