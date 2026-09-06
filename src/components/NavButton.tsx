import React from 'react';
import { useVoice } from '../context/VoiceContext';
import { LucideIcon } from 'lucide-react';
import { VoiceCommandType } from '../types';

interface NavButtonProps {
  title: string;
  command: VoiceCommandType;
  description: string;
  icon: LucideIcon;
  badgeText?: string;
  accentColor?: string;
}

export const NavButton: React.FC<NavButtonProps> = ({
  title,
  command,
  description,
  icon: Icon,
  badgeText,
}) => {
  const { executeCommand } = useVoice();

  const handleClick = () => {
    executeCommand(command);
  };

  return (
    <button
      onClick={handleClick}
      aria-label={`${title} - ${description}. Double tap or click to activate.`}
      className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border-4 border-zinc-700 hover:border-yellow-500 focus:border-yellow-400 rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 transition-all duration-300 transform active:scale-98 focus:outline-none focus:ring-8 focus:ring-yellow-500/40 group shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_0_40px_rgba(234,179,8,0.2)] flex items-center justify-between gap-6 cursor-pointer min-h-[140px]"
    >
      <div className="flex items-center space-x-6">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-zinc-950 group-hover:bg-yellow-500 text-yellow-500 group-hover:text-black flex items-center justify-center flex-shrink-0 shadow-inner border-2 border-zinc-700 group-hover:border-yellow-400 transition-colors duration-300">
          <Icon className="w-9 h-9 sm:w-11 sm:h-11 stroke-[2.5]" />
        </div>
        <div className="space-y-1.5">
          {badgeText && (
            <span className="inline-block px-3 py-1 rounded-full text-xs font-black bg-zinc-800 text-yellow-500 border border-zinc-700 uppercase tracking-widest">
              {badgeText}
            </span>
          )}
          <h2 className="text-2xl sm:text-4xl font-black text-white group-hover:text-yellow-400 uppercase tracking-tight transition-colors">
            {title}
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base font-medium">
            {description}
          </p>
        </div>
      </div>

      <div className="hidden sm:flex items-center text-zinc-400 group-hover:text-yellow-400 font-extrabold text-xs uppercase tracking-widest bg-zinc-950 px-5 py-3 rounded-2xl border border-zinc-800 group-hover:border-yellow-500/50 transition-all flex-shrink-0">
        Say "{title}"
      </div>
    </button>
  );
};
