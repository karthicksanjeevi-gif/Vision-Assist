export type VoiceCommandType = 
  | 'LIVE_NAVIGATION'
  | 'DOCUMENT_READER'
  | 'PLACE_FINDER'
  | 'HELP'
  | 'GO_BACK';

export interface VoiceState {
  isSupported: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  hasPermission: boolean | null;
  transcript: string;
  lastCommand: string | null;
  statusMessage: string;
  micError: string | null;
}

export interface NavRouteInfo {
  path: string;
  title: string;
  description: string;
  spokenName: string;
  commandKeywords: string[];
  color: string;
  iconName: string;
}
