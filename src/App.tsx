import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { VoiceProvider } from './context/VoiceContext';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { NavigationPage } from './pages/NavigationPage';
import { DocReaderPage } from './pages/DocReaderPage';
import { PlaceFinderPage } from './pages/PlaceFinderPage';

export default function App() {
  return (
    <BrowserRouter>
      <VoiceProvider>
        <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col selection:bg-yellow-500 selection:text-black">
          <Header />
          <div className="flex-1 pb-12">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/navigation" element={<NavigationPage />} />
              <Route path="/doc-reader" element={<DocReaderPage />} />
              <Route path="/place-finder" element={<PlaceFinderPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <footer className="w-full bg-zinc-900 border-t border-zinc-800 py-4 px-6 text-center text-xs text-zinc-400 font-bold uppercase tracking-widest">
            <p>VisionAssist PWA • Voice-First Accessibility Shell • Elegant Dark</p>
          </footer>
        </div>
      </VoiceProvider>
    </BrowserRouter>
  );
}
