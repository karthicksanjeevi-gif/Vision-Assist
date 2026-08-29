import React, { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safe Error Boundary Wrapper
function AppRoot() {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      console.error('Global uncaught error caught:', event.error || event.message);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('Global promise rejection caught:', event.reason);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-zinc-900 border-2 border-yellow-500 rounded-3xl p-8 space-y-6 shadow-2xl">
          <h1 className="text-3xl font-black text-yellow-500 uppercase tracking-tight">VisionAssist</h1>
          <p className="text-zinc-300 font-medium">An unexpected display issue occurred. Tap below to reload the voice accessibility system.</p>
          <button
            onClick={() => {
              setHasError(false);
              window.location.href = '/';
            }}
            className="w-full py-4 px-6 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-wider rounded-2xl transition-all cursor-pointer text-lg shadow-lg"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <App />;
}

// Register PWA Service Worker safely
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && (import.meta as any).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration skipped:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);



