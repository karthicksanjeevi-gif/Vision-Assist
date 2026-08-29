import React, { useEffect } from 'react';
import { useVoice } from '../context/VoiceContext';
import { VoiceStatusCard } from '../components/VoiceStatusCard';
import { Compass, ArrowLeft, Home, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const NavigationPage: React.FC = () => {
  const { speak, executeCommand } = useVoice();

  useEffect(() => {
    // Speak coming soon announcement when entering page
    speak('Live Navigation. This feature is coming soon. You can say Home or Go Back to return to the main screen.');
  }, [speak]);

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-8 sm:px-8 space-y-10">
      {/* Live Voice Monitor */}
      <VoiceStatusCard />

      {/* Feature Content Banner */}
      <section className="bg-zinc-900 border-4 border-zinc-700 hover:border-yellow-500 rounded-[40px] p-8 sm:p-12 space-y-6 text-center shadow-[0_10px_40px_rgba(0,0,0,0.6)] transition-all">
        <div className="w-20 h-20 sm:w-24 sm:h-24 bg-zinc-950 rounded-3xl mx-auto flex items-center justify-center text-yellow-500 shadow-inner border-2 border-zinc-700">
          <Compass className="w-12 h-12 sm:w-16 sm:h-16 stroke-[2.5]" />
        </div>

        <div className="space-y-3">
          <span className="inline-block px-4 py-1.5 bg-zinc-800 text-yellow-500 font-black text-xs uppercase tracking-widest rounded-full border border-zinc-700">
            Feature Shell • Step 1
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-white uppercase tracking-tight">
            Live Navigation
          </h1>
          <p className="text-xl sm:text-2xl font-black text-yellow-500 max-w-2xl mx-auto uppercase">
            This feature is coming soon
          </p>
          <p className="text-zinc-400 text-base sm:text-lg max-w-xl mx-auto">
            Real-time visual navigation and obstacle audio alerts will be integrated in the next phase.
          </p>
        </div>

        {/* Big Action Buttons */}
        <div className="pt-4 flex flex-wrap items-center justify-center gap-5">
          <button
            onClick={() => executeCommand('GO_BACK')}
            className="px-8 py-5 bg-white hover:bg-zinc-200 text-black font-black text-xl uppercase tracking-wider rounded-2xl transition-all focus:ring-8 focus:ring-yellow-500 flex items-center gap-3 shadow-xl cursor-pointer"
          >
            <ArrowLeft className="w-7 h-7 stroke-[3]" />
            <span>Say "Home" to Go Back</span>
          </button>

          <button
            onClick={() => executeCommand('HELP')}
            className="px-8 py-5 bg-zinc-800 hover:bg-zinc-700 text-white font-black text-xl uppercase tracking-wider rounded-2xl transition-all border border-zinc-600 flex items-center gap-2 cursor-pointer"
          >
            <HelpCircle className="w-6 h-6 text-yellow-500" />
            <span>Help</span>
          </button>
        </div>
      </section>
    </main>
  );
};
