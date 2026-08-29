import React from 'react';
import { useVoice } from '../context/VoiceContext';
import { speechEngine } from '../lib/speechService';
import { Mic, MicOff, Volume2, AlertTriangle, Radio, ShieldAlert } from 'lucide-react';

export const VoiceStatusCard: React.FC = () => {
  const {
    isSupported,
    isListening,
    isSpeaking,
    hasPermission,
    transcript,
    interimTranscript,
    statusMessage,
    micError,
    toggleListening,
    audioUnlocked,
    unlockAudio,
    requestMicPermission,
    speak,
  } = useVoice();

  return (
    <section 
      aria-label="Voice Status and Listener State"
      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden"
    >
      {/* State Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center space-x-3.5">
          <div
            className={`p-3 rounded-2xl border ${
              isSpeaking
                ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                : isListening
                ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            {isSpeaking ? (
              <Volume2 className="w-6 h-6 animate-pulse" />
            ) : isListening ? (
              <Mic className="w-6 h-6 animate-pulse" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs uppercase font-extrabold tracking-widest text-zinc-500">
                Voice Assistant Feed
              </span>
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  isListening
                    ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.8)] animate-pulse'
                    : 'bg-zinc-700'
                }`}
              />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2 mt-0.5">
              {isSpeaking ? (
                <span className="text-yellow-400">Agent Speaking...</span>
              ) : isListening ? (
                <span className="text-white">Microphone Listening</span>
              ) : (
                <span className="text-zinc-400">Microphone Paused</span>
              )}
            </h2>
          </div>
        </div>

        {/* Action Toggle & Test Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              unlockAudio();
              speechEngine.playDoubleChime();
              speak('Testing voice audio output. VisionAssist is active and speaking clearly.');
            }}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold uppercase tracking-wider border-2 border-yellow-500/60 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-black transition-all flex items-center gap-2 focus:ring-4 focus:ring-yellow-500"
            title="Click to test speech synthesis speaker sound"
          >
            <Volume2 className="w-4 h-4" />
            <span>Test Voice</span>
          </button>

          <button
            onClick={toggleListening}
            className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black uppercase tracking-wider border-2 transition-all focus:ring-4 focus:ring-yellow-500 flex items-center gap-2 ${
              isListening
                ? 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
                : 'bg-yellow-500 border-yellow-400 text-black hover:bg-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Pause Mic</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Start Mic</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Audio Visualizer Feedback Area */}
      <div className="w-full bg-[#0a0a0a] rounded-2xl border-2 border-zinc-800 p-6 sm:p-8 flex flex-col items-center justify-center relative overflow-hidden min-h-[160px] sm:min-h-[200px]">
        {/* Radial Background Glow */}
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-yellow-500 via-transparent to-transparent pointer-events-none" />

        {/* Animated Equalizer Bars */}
        <div className="flex items-end justify-center space-x-2 sm:space-x-3 h-20 sm:h-28 z-10 mb-4">
          <div className={`w-3.5 sm:w-4 bg-yellow-500 rounded-full transition-all duration-300 ${isListening ? 'h-12 animate-pulse' : 'h-4 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-600 rounded-full transition-all duration-300 ${isListening ? 'h-24 animate-bounce' : 'h-6 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-500 rounded-full transition-all duration-300 ${isListening ? 'h-32 animate-pulse' : 'h-8 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-400 rounded-full transition-all duration-300 ${isListening ? 'h-16 animate-bounce' : 'h-5 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-600 rounded-full transition-all duration-300 ${isListening ? 'h-28 animate-pulse' : 'h-7 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-500 rounded-full transition-all duration-300 ${isListening ? 'h-20 animate-bounce' : 'h-4 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-700 rounded-full transition-all duration-300 ${isListening ? 'h-10 animate-pulse' : 'h-3 opacity-40'}`} />
          <div className={`w-3.5 sm:w-4 bg-yellow-500 rounded-full transition-all duration-300 ${isListening ? 'h-26 animate-bounce' : 'h-6 opacity-40'}`} />
        </div>

        {/* Live Status Message Readout */}
        <div className="z-10 text-center space-y-1 w-full max-w-lg">
          <p className="text-zinc-300 font-mono tracking-widest text-xs sm:text-sm uppercase font-semibold flex items-center justify-center gap-2">
            <Radio className="w-4 h-4 text-yellow-500 animate-pulse" />
            <span>{statusMessage}</span>
          </p>
          {(transcript || interimTranscript) && (
            <div className="mt-2">
              <p className="text-yellow-400 font-mono text-base sm:text-xl font-bold bg-zinc-900/90 px-4 py-2 rounded-xl border border-yellow-500/40 inline-block">
                "{transcript || interimTranscript}"
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Audio & Mic Enable Banner if Audio is not yet engaged */}
      {(!audioUnlocked || hasPermission === false) && (
        <button
          onClick={unlockAudio}
          className="w-full py-4 px-6 bg-yellow-500 text-black font-black text-sm uppercase tracking-wider rounded-2xl hover:bg-yellow-400 transition-all flex items-center justify-center gap-3 shadow-[0_0_25px_rgba(234,179,8,0.4)] border-2 border-yellow-400 cursor-pointer"
        >
          <Mic className="w-5 h-5 stroke-[2.5]" />
          <span>Tap Here to Enable Voice & Microphone</span>
        </button>
      )}

      {/* Browser Support / Mic Permission Error Fallback Warning */}
      {(!isSupported || micError) && (
        <div className="bg-zinc-950 border-2 border-rose-500/80 text-rose-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <AlertTriangle className="w-6 h-6 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <h3 className="font-extrabold text-base text-rose-300 uppercase tracking-wide">
                Microphone Notice
              </h3>
              <p className="text-zinc-300 font-medium">
                {micError ||
                  'Your browser requires microphone permission. Click Grant Permission to start voice commands.'}
              </p>
            </div>
          </div>
          {isSupported && (
            <button
              onClick={() => {
                requestMicPermission();
                unlockAudio();
              }}
              className="px-4 py-2.5 bg-rose-500 text-white font-black text-xs uppercase tracking-wider rounded-xl hover:bg-rose-600 transition-colors flex-shrink-0"
            >
              Grant Permission
            </button>
          )}
        </div>
      )}
    </section>
  );
};

