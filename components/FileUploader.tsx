
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
      const filesArray = Array.from(e.dataTransfer.files).filter(file => 
        file.type.startsWith('image/')
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
          className="cursor-pointer border-2 border-dashed border-blue-200 bg-white hover:bg-blue-50 transition-all rounded-xl h-full w-full flex flex-col items-center justify-center p-4 text-center min-h-[150px]"
        >
          <input 
            type="file" 
            accept="image/*" 
            multiple 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleChange}
          />
          <span className="text-3xl mb-2 text-blue-500">+</span>
          <span className="text-sm text-gray-600 font-medium">เพิ่มรูปอีก</span>
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
        accept="image/*" 
        multiple 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleChange}
      />
      <div 
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer border-4 border-dashed border-blue-200 bg-white hover:bg-blue-50 hover:border-blue-400 transition-all duration-300 rounded-[2.5rem] p-12 flex flex-col items-center justify-center space-y-6 shadow-xl hover:shadow-2xl"
      >
        <div className="bg-blue-600 p-6 rounded-full text-white shadow-lg group-hover:scale-110 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold text-gray-700">คลิก หรือ ลากไฟล์รูปหลายๆ รูปมาที่นี่</p>
          <p className="text-gray-500 mt-2">รองรับ JPG, PNG, WebP</p>
        </div>
      </div>
    </div>
  );
};
