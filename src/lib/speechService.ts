import { VoiceCommandType } from '../types';

// Declare Web Speech API types if missing in TS DOM definitions
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export class SpeechEngine {
  private recognition: any = null;
  private isRecognitionSupported = false;
  private isSynthesisSupported = false;
  private preferredVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    this.isSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const SpeechRecognitionClass =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.isRecognitionSupported = Boolean(SpeechRecognitionClass);

    if (this.isSynthesisSupported) {
      this.initVoice();
    }
  }

  private initVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        // Find best English voice
        this.preferredVoice =
          voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel'))) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private keepAliveTimer: any = null;
  private audioContext: AudioContext | null = null;
  public lastSpokenText: string = '';

  public playChime(frequency = 587.33, duration = 0.15) {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

      gain.gain.setValueAtTime(0.2, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + duration);
    } catch (e) {
      // Ignore audio context errors gracefully
    }
  }

  public playDoubleChime() {
    this.playChime(523.25, 0.12);
    setTimeout(() => this.playChime(659.25, 0.18), 120);
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.resume();
        } else {
          this.stopKeepAlive();
        }
      }
    }, 3500);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  public getAvailableVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    return (
      voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Karen') || v.name.includes('Alex'))) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0]
    );
  }

  public async speakChunks(text: string, prefix = ''): Promise<void> {
    const fullText = prefix ? `${prefix} ${text}` : text;
    if (!fullText.trim()) return;

    // Split text into natural sentence or phrase chunks (max ~180 chars per chunk)
    const sentences = fullText.match(/[^.!?\n]+[.!?\n]+/g) || [fullText];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).length > 180) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    console.log(`[SpeechService] Queueing ${chunks.length} speech chunks (total length: ${fullText.length})`);

    for (const chunk of chunks) {
      await this.speak(chunk);
    }
  }

  public speak(text: string, onEnd?: () => void, onError?: (err: any) => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isSynthesisSupported || !text) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      try {
        this.lastSpokenText = text;

        // Play subtle audio cue so user immediately hears active feedback
        this.playChime(600, 0.08);

        // Resume synthesis if browser paused it
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        // Clear previous utterance gracefully
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        this.activeUtterance = utterance; // Keep reference to prevent GC

        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const voice = this.getAvailableVoice() || this.preferredVoice;
        if (voice) {
          utterance.voice = voice;
        }

        const maxDuration = Math.max(5000, text.length * 150);
        let isEnded = false;

        this.startKeepAlive();

        const finishSpeech = () => {
          if (isEnded) return;
          isEnded = true;
          this.stopKeepAlive();
          if (timeoutId) clearTimeout(timeoutId);
          this.activeUtterance = null;
          if (onEnd) onEnd();
          resolve();
        };

        const timeoutId = setTimeout(() => {
          if (!isEnded) {
            console.warn('Speech synthesis safety timeout reached');
            this.stopSpeaking();
            finishSpeech();
          }
        }, maxDuration);

        utterance.onend = () => {
          finishSpeech();
        };

        utterance.onerror = (evt) => {
          if (evt.error !== 'canceled' && evt.error !== 'interrupted') {
            console.warn('Speech synthesis warning/error:', evt.error || evt);
            if (onError) onError(evt);
          }
          finishSpeech();
        };

        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn('Speech synthesis trigger catch:', e);
        this.stopKeepAlive();
        this.activeUtterance = null;
        if (onEnd) onEnd();
        resolve();
      }
    });
  }

  public stopSpeaking() {
    this.stopKeepAlive();
    if (this.isSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
  }

  public parseCommand(rawText: string): VoiceCommandType | null {
    const text = rawText.toLowerCase().replace(/[^\w\s]/gi, '').trim();
    if (!text) return null;

    // Apply phonetic normalization for Speech-To-Text variations (e.g. "scane", "can document", "skan")
    const normalized = text
      .replace(/\b(scane|skan|scanne|scand|scanned|scanner|scanning|can|cam|ken|con|skin)\b/g, 'scan')
      .replace(/\b(doc|docs)\b/g, 'document');

    // Help command
    if (
      normalized.includes('help') ||
      normalized.includes('options') ||
      normalized.includes('commands') ||
      normalized.includes('what can i say') ||
      normalized.includes('instructions')
    ) {
      return 'HELP';
    }

    // Go Back / Home command
    if (
      normalized.includes('home') ||
      normalized.includes('go back') ||
      normalized.includes('back') ||
      normalized.includes('main menu') ||
      normalized.includes('return')
    ) {
      return 'GO_BACK';
    }

    // Live Navigation
    if (
      normalized.includes('live navigation') ||
      normalized.includes('navigation') ||
      normalized.includes('navigate') ||
      normalized.includes('nav') ||
      normalized.includes('start navigation') ||
      normalized.includes('open navigation') ||
      normalized.includes('live nav')
    ) {
      return 'LIVE_NAVIGATION';
    }

    // Document Reader
    if (
      normalized.includes('document reader') ||
      normalized.includes('doc reader') ||
      normalized.includes('document') ||
      normalized.includes('reader') ||
      normalized.includes('read document') ||
      normalized.includes('open reader') ||
      normalized.includes('scan document') ||
      normalized.includes('read doc') ||
      normalized.includes('scane') ||
      normalized.includes('can document') ||
      normalized.includes('scan')
    ) {
      return 'DOCUMENT_READER';
    }

    // Place Finder
    if (
      normalized.includes('place finder') ||
      normalized.includes('place') ||
      normalized.includes('places') ||
      normalized.includes('finder') ||
      normalized.includes('find places') ||
      normalized.includes('open place finder') ||
      normalized.includes('search places') ||
      normalized.includes('location finder')
    ) {
      return 'PLACE_FINDER';
    }

    return null;
  }

  public checkSupport() {
    return {
      synthesis: this.isSynthesisSupported,
      recognition: this.isRecognitionSupported,
    };
  }
}

export const speechEngine = new SpeechEngine();
