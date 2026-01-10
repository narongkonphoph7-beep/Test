
export interface ProcessingResult {
  originalText: string;
  summary: string;
  audioBase64?: string;
  isAudioUnavailable?: boolean; // New flag for UI fallback
}

export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PROCESSING_OCR = 'PROCESSING_OCR',
  SUMMARIZING = 'SUMMARIZING',
  GENERATING_VOICE = 'GENERATING_VOICE',
  FINISHING = 'FINISHING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface AppState {
  status: AppStatus;
  result: ProcessingResult | null;
  error: string | null;
  progressMessage: string;
}
