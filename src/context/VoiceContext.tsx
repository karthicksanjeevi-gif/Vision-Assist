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
  unlockAudio: () => void;
  requestMicPermission: () => Promise<boolean>;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

const GREETING_TEXT = "Welcome to VisionAssist. You can say Live Navigation, Document Reader, or Place Finder.";
const HELP_TEXT = "Available commands: Say Live Navigation, Document Reader, or Place Finder to open a feature. Say Help to repeat these instructions, or say Home or Go Back to return to the main screen.";

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
  const [statusMessage, setStatusMessage] = useState<string>('Initializing VisionAssist...');
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

  const registerCommandListener = useCallback((listener: ((transcript: string) => boolean) | null) => {
    customListenerRef.current = listener;
    return () => {
      if (customListenerRef.current === listener) {
        customListenerRef.current = null;
      }
    };
  }, []);

  // Sync refs with state
  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  const interimDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedTranscriptRef = useRef<string>('');

  const updateIsListening = useCallback((val: boolean) => {
    isListeningRef.current = val;
    setIsListening(val);
  }, []);

  const updateHasPermission = useCallback((val: boolean | null) => {
    hasPermissionRef.current = val;
    setHasPermission(val);
  }, []);

  // Explicitly request browser microphone permission
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release stream tracks so SpeechRecognition webkit instance can access audio device exclusively
        stream.getTracks().forEach((track) => track.stop());
        updateHasPermission(true);
        setMicError(null);
        return true;
      } catch (err: any) {
        console.warn('Microphone permission request error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          updateHasPermission(false);
          setMicError('Microphone permission denied by browser. Please allow microphone access in browser settings.');
        } else {
          setMicError('Microphone hardware not available or busy.');
        }
        return false;
      }
    }
    return true;
  }, [updateHasPermission]);

  // Safe restart mechanism for continuous voice access
  const restartListening = useCallback(() => {
    if (!shouldListenRef.current || !recognitionRef.current) return;
    if (isSpeakingRef.current) return; // Do not turn on mic while agent is speaking

    try {
      recognitionRef.current.start();
      updateIsListening(true);
      if (hasPermissionRef.current === null) {
        updateHasPermission(true);
      }
    } catch (e: any) {
      if (
        e?.name === 'InvalidStateError' ||
        (e?.message && (e.message.includes('already started') || e.message.includes('started')))
      ) {
        if (!isSpeakingRef.current) {
          updateIsListening(true);
        }
      } else {
        console.warn('SpeechRecognition start error:', e);
        setTimeout(() => {
          if (shouldListenRef.current && recognitionRef.current && !isSpeakingRef.current) {
            try {
              recognitionRef.current.start();
              updateIsListening(true);
            } catch (err) {
              // Watchdog will pick it up on next cycle
            }
          }
        }, 200);
      }
    }
  }, [updateIsListening, updateHasPermission]);

  // Unified speak function - mic turns off while agent speaks and restarts after speaking finishes
  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!text) return;
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      // Stop mic recognition while agent is speaking
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
      updateIsListening(false);

      return new Promise((resolve) => {
        speechEngine.speak(
          text,
          () => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setStatusMessage('Agent finished speaking. Microphone listening...');
            if (shouldListenRef.current) {
              restartListening();
            }
            resolve();
          },
          (_err) => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setStatusMessage('Microphone listening...');
            if (shouldListenRef.current) {
              restartListening();
            }
            resolve();
          }
        );
      });
    },
    [restartListening, updateIsListening]
  );

  const speakChunks = useCallback(
    async (text: string, prefix = ''): Promise<void> => {
      if (!text) return;
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      // Stop mic recognition while agent is speaking
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
      updateIsListening(false);

      try {
        await speechEngine.speakChunks(text, prefix);
      } finally {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setStatusMessage('Agent finished speaking. Microphone listening...');
        if (shouldListenRef.current) {
          restartListening();
        }
      }
    },
    [restartListening, updateIsListening]
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

  // Initialize SpeechRecognition instance ONCE on mount
  useEffect(() => {
    const support = speechEngine.checkSupport();
    setIsSupported(support.recognition);

    const SpeechRecognitionClass =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      setMicError('Speech Recognition API is not supported in this browser.');
      setStatusMessage('Voice recognition unavailable in this browser.');
      return;
    }

    try {
      const rec = new SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        updateIsListening(true);
        updateHasPermission(true);
        setMicError(null);
        setStatusMessage('System listening for commands...');
      };

      rec.onresult = (event: any) => {
        // Ignore microphone input captured while agent TTS is actively speaking
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
          if (clean === lastProcessedTranscriptRef.current) return;

          lastProcessedTranscriptRef.current = clean;
          setTranscript(clean);
          setInterimTranscript('');
          setStatusMessage(`Heard: "${clean}"`);

          // Allow same transcript again after 2 seconds
          setTimeout(() => {
            if (lastProcessedTranscriptRef.current === clean) {
              lastProcessedTranscriptRef.current = '';
            }
          }, 2000);

          // Try page-specific custom command listener first
          let handled = false;
          if (customListenerRef.current) {
            try {
              handled = customListenerRef.current(clean);
            } catch (e) {
              console.error('Error in page voice command listener:', e);
            }
          }

          if (!handled) {
            // Fallback to global voice navigation commands
            const detectedCmd = speechEngine.parseCommand(clean);
            if (detectedCmd) {
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

          // Debounce interim input: if user pauses for 650ms, process candidate transcript
          interimDebounceTimerRef.current = setTimeout(() => {
            handleSpokenText(candidate);
          }, 650);
        }
      };

      rec.onerror = (event: any) => {
        const errorType = event.error || 'unknown';
        // Suppress benign aborted warnings
        if (errorType !== 'aborted' && errorType !== 'no-speech') {
          console.warn('SpeechRecognition error:', errorType);
        }

        if (errorType === 'not-allowed' || errorType === 'service-not-allowed' || errorType === 'audio-capture') {
          setMicError('Microphone gesture required.');
          setStatusMessage('Voice System Active. Tap screen or "Activate Voice System" to start microphone.');
        } else if (errorType === 'no-speech') {
          // Quiet timeout, handled safely on onend
        } else if (errorType === 'network') {
          setMicError('Network connection needed for browser speech recognition.');
        }
      };

      rec.onend = () => {
        if (!shouldListenRef.current || isSpeakingRef.current) {
          updateIsListening(false);
          return;
        }

        // Voice access remains ON and agent not speaking - trigger restart
        updateIsListening(true);
        setTimeout(() => {
          if (shouldListenRef.current && !isSpeakingRef.current) {
            restartListening();
          }
        }, 100);
      };

      recognitionRef.current = rec;
      shouldListenRef.current = true;
      updateIsListening(true);

      // Attempt initial start safely
      try {
        rec.start();
      } catch (err) {
        // Safe fallback if browser requires user gesture first
        setStatusMessage('Voice System Active. Tap screen or "Activate Voice System" to enable.');
      }
    } catch (err) {
      console.warn('Failed to instantiate SpeechRecognition:', err);
      setIsSupported(false);
      setMicError('Failed to initialize speech recognition.');
    }

    return () => {
      shouldListenRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [updateIsListening, updateHasPermission, restartListening]);

  // Watchdog loop to ensure voice listener stays continuously active while app is running
  useEffect(() => {
    const interval = setInterval(() => {
      if (shouldListenRef.current && recognitionRef.current && !isSpeakingRef.current) {
        restartListening();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [restartListening]);

  // Speak welcome greeting automatically on initial load
  useEffect(() => {
    if (!hasSpokenGreetingRef.current && location.pathname === '/') {
      hasSpokenGreetingRef.current = true;
      speakGreeting();
    }
  }, [location.pathname, speakGreeting]);

  // Global listener for user interaction to unlock audio and resume voice system
  useEffect(() => {
    const handleGesture = async () => {
      speechEngine.playChime(587, 0.08);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
      setAudioUnlocked(true);

      if (shouldListenRef.current) {
        if (hasPermissionRef.current === null || hasPermissionRef.current === false) {
          await requestMicPermission();
        }
        restartListening();
      }
    };

    window.addEventListener('click', handleGesture, { once: false });
    window.addEventListener('touchstart', handleGesture, { once: false });

    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, [restartListening, requestMicPermission]);

  // Audio unlock helper for strict browser policies
  const unlockAudio = useCallback(async () => {
    speechEngine.playDoubleChime();
    setAudioUnlocked(true);

    const micOk = await requestMicPermission();
    shouldListenRef.current = true;
    updateIsListening(true);

    if (micOk) {
      speakText('Audio enabled. Voice Assistant is active and listening.');
    } else {
      speakText('Microphone permission needed. Please allow microphone access.');
    }

    restartListening();
  }, [requestMicPermission, restartListening, updateIsListening, speakText]);

  const startListening = useCallback(async () => {
    shouldListenRef.current = true;
    const micOk = await requestMicPermission();
    if (micOk) {
      updateIsListening(true);
      restartListening();
    }
  }, [requestMicPermission, restartListening, updateIsListening]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // ignore
      }
    }
    updateIsListening(false);
  }, [updateIsListening]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
      setStatusMessage('Voice recognition paused.');
      speakText('Voice recognition paused');
    } else {
      startListening();
      setStatusMessage('Voice recognition active...');
      speakText('Voice recognition active');
    }
  }, [startListening, stopListening, speakText]);

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
