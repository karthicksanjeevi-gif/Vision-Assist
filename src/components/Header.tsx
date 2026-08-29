import React from 'react';
import { useVoice } from '../context/VoiceContext';
import { Mic, MicOff, Volume2, HelpCircle, Eye } from 'lucide-react';

export const Header: React.FC = () => {
  const { isListening, isSpeaking, toggleListening, speakHelp } = useVoice();

  return (
    <header className="w-full bg-[#0a0a0a]/90 backdrop-blur-md border-b border-zinc-800 px-4 py-4 sm:px-8 sm:py-6 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand Logo & Name */}
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-yellow-500 flex items-center justify-center text-black font-extrabold shadow-[0_0_20px_rgba(234,179,8,0.4)] border border-yellow-400">
            <Eye className="w-7 h-7 text-black stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter text-yellow-500 uppercase">
              VisionAssist
            </h1>
            <p className="text-xs text-zinc-500 font-medium tracking-wide">Voice-First Accessibility Shell</p>
          </div>
        </div>

        {/* Live Controls & Indicators */}
        <div className="flex items-center space-x-3">
          {/* Audio Speaking Badge */}
          {isSpeaking && (
            <div className="flex items-center space-x-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/50 text-yellow-400 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse">
              <Volume2 className="w-4 h-4 text-yellow-500" />
              <span>Speaking</span>
            </div>
          )}

          {/* System Listening Indicator Badge */}
          <div className="hidden md:flex items-center space-x-3 bg-zinc-900/80 px-5 py-2.5 rounded-full border border-zinc-800">
            <div className={`w-3.5 h-3.5 rounded-full ${isListening ? 'bg-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.8)] animate-pulse' : 'bg-zinc-600'}`}></div>
            <span className="text-xs font-bold tracking-widest uppercase text-zinc-300">
              {isListening ? 'System Listening' : 'System Paused'}
            </span>
          </div>

          {/* Voice Mic Toggle Button */}
          <button
            onClick={toggleListening}
            aria-label={isListening ? 'Mute microphone' : 'Unmute microphone'}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider transition-all focus:outline-none focus:ring-4 focus:ring-yellow-500 border ${
              isListening
                ? 'bg-zinc-900 border-zinc-700 text-emerald-400 hover:bg-zinc-800'
                : 'bg-zinc-900 border-rose-500/50 text-rose-300 hover:bg-zinc-800'
            }`}
          >
            {isListening ? (
              <>
                <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">Mic On</span>
              </>
            ) : (
              <>
                <MicOff className="w-4 h-4 text-rose-400" />
                <span className="hidden sm:inline">Mic Off</span>
              </>
            )}
          </button>

          {/* Global Help Speech Trigger */}
          <button
            onClick={speakHelp}
            aria-label="Speak available commands help"
            className="flex items-center space-x-2 px-5 py-2.5 bg-white text-black hover:bg-zinc-200 font-black rounded-xl text-sm uppercase transition-colors focus:outline-none focus:ring-4 focus:ring-yellow-500 shadow-lg"
          >
            <HelpCircle className="w-4 h-4 text-black stroke-[3]" />
            <span className="font-black">Help</span>
          </button>
        </div>
      </div>
    </header>
  );
};
