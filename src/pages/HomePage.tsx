import React from 'react';
import { VoiceStatusCard } from '../components/VoiceStatusCard';
import { NavButton } from '../components/NavButton';
import { Compass, FileText, MapPin, Volume2, Mic, HelpCircle } from 'lucide-react';
import { useVoice } from '../context/VoiceContext';

export const HomePage: React.FC = () => {
  const { speakGreeting, speakHelp } = useVoice();

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-8 sm:px-8 space-y-10">
      {/* Voice Status & Visualizer Card */}
      <VoiceStatusCard />

      {/* Main Accessibility Action Hub */}
      <section aria-label="Available Main Features" className="space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-xl sm:text-2xl font-black text-yellow-500 uppercase tracking-tight flex items-center gap-2.5">
            <Mic className="w-6 h-6 text-yellow-500" />
            <span>Select Feature or Speak Command</span>
          </h2>
          <button
            onClick={speakGreeting}
            className="text-xs sm:text-sm font-bold text-zinc-400 hover:text-yellow-400 underline underline-offset-4 flex items-center gap-1.5 focus:ring-2 focus:ring-yellow-500 p-1.5 rounded-lg transition-colors"
          >
            <Volume2 className="w-4 h-4 text-yellow-500" />
            Re-play Greeting
          </button>
        </div>

        {/* The 3 Big High-Contrast Feature Buttons */}
        <div className="grid grid-cols-1 gap-6">
          <NavButton
            title="Live Navigation"
            command="LIVE_NAVIGATION"
            description="Real-time obstacle detection & route guidance"
            icon={Compass}
            badgeText="Feature 1"
          />

          <NavButton
            title="Document Reader"
            command="DOCUMENT_READER"
            description="Read printed text, signboards & documents aloud"
            icon={FileText}
            badgeText="Feature 2"
          />

          <NavButton
            title="Place Finder"
            command="PLACE_FINDER"
            description="Locate nearby rooms, landmarks & points of interest"
            icon={MapPin}
            badgeText="Feature 3"
          />
        </div>
      </section>

      {/* Global Voice Commands Quick Guide */}
      <section 
        aria-label="Spoken Commands Cheat Sheet"
        className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <h3 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-yellow-500" />
            <span>Supported Voice Phrases</span>
          </h3>
          <button
            onClick={speakHelp}
            className="px-4 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/40 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-yellow-500/20 transition-colors"
          >
            Speak Commands
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="bg-[#0a0a0a] p-4 rounded-2xl border border-zinc-800 space-y-1">
            <span className="text-yellow-500 font-black uppercase tracking-wide">"Live Navigation"</span>
            <p className="text-zinc-400 text-xs">
              Variations: "Navigation", "Start Navigation", "Open Navigation"
            </p>
          </div>

          <div className="bg-[#0a0a0a] p-4 rounded-2xl border border-zinc-800 space-y-1">
            <span className="text-yellow-500 font-black uppercase tracking-wide">"Document Reader"</span>
            <p className="text-zinc-400 text-xs">
              Variations: "Scan Document", "Scane Document Reader", "Can Document", "Doc Reader"
            </p>
          </div>

          <div className="bg-[#0a0a0a] p-4 rounded-2xl border border-zinc-800 space-y-1">
            <span className="text-yellow-500 font-black uppercase tracking-wide">"Place Finder"</span>
            <p className="text-zinc-400 text-xs">
              Variations: "Places", "Find Places", "Open Place Finder"
            </p>
          </div>

          <div className="bg-[#0a0a0a] p-4 rounded-2xl border border-zinc-800 space-y-1">
            <span className="text-yellow-500 font-black uppercase tracking-wide">"Help" / "Go Back"</span>
            <p className="text-zinc-400 text-xs">
              Say "Help" to repeat options. Say "Home" or "Go Back" from any screen.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
};
