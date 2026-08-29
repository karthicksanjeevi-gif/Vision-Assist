import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { speechEngine } from '../lib/speechService';
import { VoiceCommandType } from '../types';

interface VoiceContextType {
  isSupported: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  hasPermission: boolean | null;
  transcript: string;
  interimTranscript: string;
  lastCommand: string | null;
  statusMessage: string;
  micError: string | null;
  setStatusMessage: (msg: string) => void;
  registerCommandListener: (listener: ((transcript: string) => boolean) | null) => () => void;
  speak: (text: string) => Promise<void>;
  speakChunks: (text: string, prefix?: string) => Promise<void>;
  speakGreeting: () => void;
  speakHelp: () => void;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  executeCommand: (cmd: VoiceCommandType) => void;
  audioUnlocked: boolean;
  unlockAudio: () => Promise<void>;
  requestMicPermission: () => Promise<boolean>;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

const GREETING_TEXT = 'Welcome to VisionAssist. You can say Live Navigation, Document Reader, or Place Finder.';
const HELP_TEXT = 'Available commands: Say Live Navigation, Document Reader, or Place Finder to open a feature. Say Help to repeat these instructions, or say Home or Go Back to return to the main screen.';

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Tap anywhere or speak a command...');
  const [micError, setMicError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(true);
  const isListeningRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const hasPermissionRef = useRef<boolean | null>(null);
  const hasSpokenGreetingRef = useRef<boolean>(false);
  const currentPathRef = useRef<string>(location.pathname);
  const customListenerRef = useRef<((transcript: string) => boolean) | null>(null);
  const interimDebounceTimerRef = useRef<any>(null);
  const lastProcessedTranscriptRef = useRef<string>('');
  const restartTimeoutRef = useRef<any>(null);

  const registerCommandListener = useCallback((listener: ((transcript: string) => boolean) | null) => {
    customListenerRef.current = listener;
    return () => {
      if (customListenerRef.current === listener) {
        customListenerRef.current = null;
      }
    };
  }, []);

  // Sync current path ref
  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  const updateIsListening = useCallback((val: boolean) => {
    isListeningRef.current = val;
    setIsListening(val);
  }, []);

  const updateHasPermission = useCallback((val: boolean | null) => {
    hasPermissionRef.current = val;
    setHasPermission(val);
  }, []);

  // Safe recognition destruction
  const cleanupRecognition = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch (e) {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  // Helper to start a fresh SpeechRecognition session
  const startRecognitionSession = useCallback(() => {
    if (!shouldListenRef.current) return;
    if (isSpeakingRef.current) return;

    const SpeechRecClass = speechEngine.getSpeechRecognitionClass();
    if (!SpeechRecClass) {
      setIsSupported(false);
      setMicError('Speech Recognition is not supported in this browser.');
      return;
    }

    cleanupRecognition();

    try {
      const rec = new SpeechRecClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = 3;

      rec.onstart = () => {
        updateIsListening(true);
        updateHasPermission(true);
        setMicError(null);
        setStatusMessage('Voice listening for commands...');
      };

      rec.onresult = (event: any) => {
        // Drop input if agent is speaking
        if (isSpeakingRef.current) {
          return;
        }

        let finalTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            currentInterim += result[0].transcript;
          }
        }

        const handleSpokenText = (spoken: string) => {
          const clean = spoken.trim();
          if (!clean) return;

          // Prevent immediate repetitive duplicate processing within 1.5s
          if (clean.toLowerCase() === lastProcessedTranscriptRef.current.toLowerCase()) {
            return;
          }

          lastProcessedTranscriptRef.current = clean;
          setTranscript(clean);
          setInterimTranscript('');
          setStatusMessage(`Heard: "${clean}"`);

          setTimeout(() => {
            if (lastProcessedTranscriptRef.current === clean) {
              lastProcessedTranscriptRef.current = '';
            }
          }, 1500);

          // Try page-specific custom command listener first
          let handled = false;
          if (customListenerRef.current) {
            try {
              handled = customListenerRef.current(clean);
            } catch (e) {
              console.error('[VoiceContext] Error in page custom voice listener:', e);
            }
          }

          if (!handled) {
            // Global navigation commands
            const detectedCmd = speechEngine.parseCommand(clean);
            if (detectedCmd) {
              speechEngine.playSuccessChime();
              executeCommandRef.current(detectedCmd);
            }
          }
        };

        if (finalTranscript.trim()) {
          if (interimDebounceTimerRef.current) {
            clearTimeout(interimDebounceTimerRef.current);
            interimDebounceTimerRef.current = null;
          }
          handleSpokenText(finalTranscript);
        } else if (currentInterim.trim()) {
          const candidate = currentInterim.trim();
          setInterimTranscript(candidate);
          setStatusMessage(`Listening: "${candidate}"...`);

          if (interimDebounceTimerRef.current) {
            clearTimeout(interimDebounceTimerRef.current);
          }

          // Check if candidate matches a decisive single command right away
          const quickCmd = speechEngine.parseCommand(candidate);
          if (quickCmd && (candidate.split(' ').length >= 2 || ['help', 'home', 'back'].includes(candidate.toLowerCase()))) {
            interimDebounceTimerRef.current = setTimeout(() => {
              handleSpokenText(candidate);
            }, 350);
          } else {
            // Debounce interim input
            interimDebounceTimerRef.current = setTimeout(() => {
              handleSpokenText(candidate);
            }, 600);
          }
        }
      };

      rec.onerror = (event: any) => {
        const errorType = event.error || 'unknown';

        if (errorType === 'not-allowed' || errorType === 'service-not-allowed') {
          updateHasPermission(false);
          updateIsListening(false);
          setMicError('Microphone permission required. Tap "Enable Voice & Microphone".');
          setStatusMessage('Tap screen or "Activate Voice" to grant microphone access.');
          return;
        }

        if (errorType === 'audio-capture') {
          setMicError('No microphone hardware detected or microphone is busy.');
          updateIsListening(false);
          return;
        }

        if (errorType === 'network') {
          console.warn('[VoiceContext] Speech recognition network warning.');
        }
      };

      rec.onend = () => {
        updateIsListening(false);

        // Auto restart if should be listening and agent is not speaking
        if (shouldListenRef.current && !isSpeakingRef.current && hasPermissionRef.current !== false) {
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = setTimeout(() => {
            if (shouldListenRef.current && !isSpeakingRef.current) {
              startRecognitionSession();
            }
          }, 150);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err: any) {
      if (err?.name !== 'InvalidStateError') {
        console.warn('[VoiceContext] Speech recognition start exception:', err);
      }
    }
  }, [cleanupRecognition, updateIsListening, updateHasPermission]);

  // Request browser microphone permission explicitly
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        updateHasPermission(true);
        setMicError(null);
        return true;
      } catch (err: any) {
        console.warn('[VoiceContext] Microphone permission error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          updateHasPermission(false);
          setMicError('Microphone permission was denied in browser settings.');
        } else {
          setMicError('Microphone device unavailable.');
        }
        return false;
      }
    }
    return true;
  }, [updateHasPermission]);

  // Unified speak function
  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!text) return;
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      // Temporarily halt recognition while assistant speaks to avoid self-hearing
      cleanupRecognition();
      updateIsListening(false);

      return new Promise((resolve) => {
        speechEngine.speak(
          text,
          () => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setStatusMessage('Agent finished. Listening for your command...');
            if (shouldListenRef.current) {
              startRecognitionSession();
            }
            resolve();
          },
          (_err) => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setStatusMessage('Listening for your command...');
            if (shouldListenRef.current) {
              startRecognitionSession();
            }
            resolve();
          }
        );
      });
    },
    [cleanupRecognition, startRecognitionSession, updateIsListening]
  );

  const speakChunks = useCallback(
    async (text: string, prefix = ''): Promise<void> => {
      if (!text) return;
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      cleanupRecognition();
      updateIsListening(false);

      try {
        await speechEngine.speakChunks(text, prefix);
      } finally {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setStatusMessage('Agent finished. Listening for your command...');
        if (shouldListenRef.current) {
          startRecognitionSession();
        }
      }
    },
    [cleanupRecognition, startRecognitionSession, updateIsListening]
  );

  const speakHelp = useCallback(() => {
    setStatusMessage('Speaking instructions...');
    speakText(HELP_TEXT);
  }, [speakText]);

  const speakGreeting = useCallback(() => {
    setStatusMessage('Welcome to VisionAssist');
    speakText(GREETING_TEXT);
  }, [speakText]);

  // Execute recognized command
  const executeCommand = useCallback(
    (command: VoiceCommandType) => {
      setLastCommand(command);

      switch (command) {
        case 'LIVE_NAVIGATION':
          setStatusMessage('Opening Live Navigation...');
          speakText('Opening Live Navigation').then(() => {
            navigate('/navigation');
          });
          break;

        case 'DOCUMENT_READER':
          setStatusMessage('Opening Document Reader...');
          speakText('Opening Document Reader').then(() => {
            navigate('/doc-reader');
          });
          break;

        case 'PLACE_FINDER':
          setStatusMessage('Opening Place Finder...');
          speakText('Opening Place Finder').then(() => {
            navigate('/place-finder');
          });
          break;

        case 'HELP':
          speakHelp();
          break;

        case 'GO_BACK':
          if (currentPathRef.current === '/') {
            setStatusMessage('Already on Home screen.');
            speakText('You are already on the home page.');
          } else {
            setStatusMessage('Going back to Home page...');
            speakText('Going back to home page').then(() => {
              navigate('/');
            });
          }
          break;
      }
    },
    [navigate, speakText, speakHelp]
  );

  const executeCommandRef = useRef(executeCommand);
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  // Unlock Audio & Start Voice helper
  const unlockAudio = useCallback(async () => {
    speechEngine.playDoubleChime();
    setAudioUnlocked(true);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }

    shouldListenRef.current = true;
    const micOk = await requestMicPermission();

    if (micOk) {
      startRecognitionSession();
      if (!hasSpokenGreetingRef.current && location.pathname === '/') {
        hasSpokenGreetingRef.current = true;
        speakText('Voice Assistant is active and listening. Say Live Navigation, Document Reader, or Place Finder.');
      } else {
        speakText('Voice Assistant active and listening.');
      }
    } else {
      speakText('Microphone access is required for voice commands. Please allow microphone access in your browser.');
    }
  }, [requestMicPermission, startRecognitionSession, speakText, location.pathname]);

  const startListening = useCallback(async () => {
    shouldListenRef.current = true;
    const micOk = await requestMicPermission();
    if (micOk) {
      startRecognitionSession();
    }
  }, [requestMicPermission, startRecognitionSession]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    cleanupRecognition();
    updateIsListening(false);
  }, [cleanupRecognition, updateIsListening]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
      setStatusMessage('Voice recognition paused.');
      speakText('Voice recognition paused');
    } else {
      shouldListenRef.current = true;
      startListening();
      setStatusMessage('Voice recognition active...');
      speakText('Voice recognition active');
    }
  }, [startListening, stopListening, speakText]);

  // Initial check for Speech Recognition support
  useEffect(() => {
    const support = speechEngine.checkSupport();
    setIsSupported(support.recognition);

    if (!support.recognition) {
      setIsSupported(false);
      setMicError('Speech Recognition is not supported in this browser. Please use Google Chrome or Edge.');
      setStatusMessage('Voice recognition unavailable in this browser.');
    }

    // Try initial startup safely
    shouldListenRef.current = true;
    startRecognitionSession();

    return () => {
      shouldListenRef.current = false;
      cleanupRecognition();
    };
  }, [startRecognitionSession, cleanupRecognition]);

  // User gesture interaction listener to unlock audio & microphone gracefully
  useEffect(() => {
    const handleFirstGesture = async () => {
      if (!audioUnlocked) {
        setAudioUnlocked(true);
        speechEngine.playChime(587.33, 0.08);

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        }

        if (shouldListenRef.current && (!isListeningRef.current || hasPermissionRef.current === null)) {
          const micOk = await requestMicPermission();
          if (micOk) {
            startRecognitionSession();
          }
        }
      }
    };

    window.addEventListener('click', handleFirstGesture, { passive: true });
    window.addEventListener('touchstart', handleFirstGesture, { passive: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true });

    return () => {
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, [audioUnlocked, requestMicPermission, startRecognitionSession]);

  // Auto speak greeting if audio is ready
  useEffect(() => {
    if (audioUnlocked && !hasSpokenGreetingRef.current && location.pathname === '/') {
      hasSpokenGreetingRef.current = true;
      speakGreeting();
    }
  }, [audioUnlocked, location.pathname, speakGreeting]);

  return (
    <VoiceContext.Provider
      value={{
        isSupported,
        isListening,
        isSpeaking,
        hasPermission,
        transcript,
        interimTranscript,
        lastCommand,
        statusMessage,
        micError,
        setStatusMessage,
        registerCommandListener,
        speak: speakText,
        speakChunks,
        speakGreeting,
        speakHelp,
        startListening,
        stopListening,
        toggleListening,
        executeCommand,
        audioUnlocked,
        unlockAudio,
        requestMicPermission,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = () => {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
};
