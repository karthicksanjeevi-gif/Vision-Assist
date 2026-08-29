import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useVoice } from '../context/VoiceContext';
import { VoiceStatusCard } from '../components/VoiceStatusCard';
import { detectCodeFromCanvas, isFormOrAgreement, CodeDetectionResult } from '../lib/scannerUtils';
import {
  FileText,
  Camera,
  QrCode,
  ArrowLeft,
  RotateCcw,
  Volume2,
  Sparkles,
  ExternalLink,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Scale
} from 'lucide-react';
import { recognize } from 'tesseract.js';

type ScanMode = 'IDLE' | 'DOC_SCAN_PREPARE' | 'DOC_SCANNING' | 'CODE_SCANNING' | 'RESULT';

export const DocReaderPage: React.FC = () => {
  const { speak, speakChunks, setStatusMessage, registerCommandListener, executeCommand } = useVoice();

  // Component state
  const [mode, setMode] = useState<ScanMode>('IDLE');
  const [activeScanType, setActiveScanType] = useState<'document' | 'code' | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState<boolean>(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [keyDetails, setKeyDetails] = useState<string[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [detectedCode, setDetectedCode] = useState<CodeDetectionResult | null>(null);
  const [pendingCodeToConfirm, setPendingCodeToConfirm] = useState<CodeDetectionResult | null>(null);
  const [ignoredCodes, setIgnoredCodes] = useState<Set<string>>(new Set());

  // Operations requested by user (summary, advantages, disadvantages, both)
  const [userRequestedOperation, setUserRequestedOperation] = useState<string | null>(null);
  const [operationResult, setOperationResult] = useState<{
    title: string;
    spokenResult: string;
    summary?: string;
    advantages?: string[];
    disadvantages?: string[];
  } | null>(null);
  const [isAnalyzingOperation, setIsAnalyzingOperation] = useState<boolean>(false);

  // Refs for camera media stream and auto-capture timer
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoCaptureTimerRef = useRef<any>(null);
  const codeScanIntervalRef = useRef<any>(null);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }
    if (codeScanIntervalRef.current) {
      clearInterval(codeScanIntervalRef.current);
      codeScanIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Continuously attach mediaStream to videoRef as soon as video element is mounted in DOM
  useEffect(() => {
    if (isCameraActive && mediaStreamRef.current && videoRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== mediaStreamRef.current) {
        video.srcObject = mediaStreamRef.current;
        video.play().catch((err) => console.warn('Video element play error:', err));
      }
    }
  }, [isCameraActive, mode]);

  // Entry spoken welcome
  useEffect(() => {
    speak(
      "Document Reader. Say 'scan document' to read a paper or card, or 'scan code' to look for a QR or barcode. Say Home to go back."
    );
    setStatusMessage("Say 'scan document' or 'scan code'");
  }, [speak, setStatusMessage]);

  // Start Camera with user permission
  const initCamera = useCallback(
    async (type: 'document' | 'code') => {
      stopCamera();
      setCameraError(null);
      setActiveScanType(type);

      const promptMsg =
        type === 'document'
          ? 'I need access to your camera to scan the document'
          : 'I need access to your camera to scan the code';

      setStatusMessage(`Requesting camera for ${type}...`);
      
      await speak(promptMsg);
      await new Promise((r) => setTimeout(r, 200));

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        mediaStreamRef.current = stream;
        setIsCameraActive(true);

        const targetMode = type === 'document' ? 'DOC_SCANNING' : 'CODE_SCANNING';
        setMode(targetMode);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (type === 'document') {
          setStatusMessage("Camera ready. Say 'capture' or hold steady.");
          await speak(
            "Say 'capture' when you're ready, or hold the document steady and I'll capture automatically in a moment."
          );

          // Auto capture fallback after 5.5 seconds of holding steady
          autoCaptureTimerRef.current = setTimeout(() => {
            captureDocument();
          }, 5500);
        } else {
          setStatusMessage('Scanning for QR or Barcodes...');
          await speak('Code scanner active. Point camera at a QR or barcode.');
        }
      } catch (err: any) {
        console.error('Camera access error:', err);
        setIsCameraActive(false);
        setCameraError('Camera access denied or unavailable.');
        setStatusMessage('Camera access denied.');
        await speak(
          'Microphone or camera access was denied in your browser settings. Document reader requires camera permission to scan.'
        );
        setMode('IDLE');
      }
    },
    [speak, setStatusMessage, stopCamera]
  );

  // Capture photo and run AI Vision / OCR analysis
  const captureDocument = useCallback(async () => {
    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }

    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert frame to base64 JPEG image for AI vision analysis
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedImage(imageBase64);

    // Stop camera now that frame is captured
    stopCamera();

    setIsProcessingOCR(true);
    setStatusMessage('Analyzing document with AI vision...');
    await speak('Capturing document image. Reading text and analyzing clearly, please wait...');

    try {
      let apiData: any = null;
      try {
        const res = await fetch('/api/analyze-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64 }),
        });
        if (res.ok) {
          apiData = await res.json();
        }
      } catch (apiErr) {
        console.warn('Backend document vision API error:', apiErr);
      }

      let localOcrText = '';
      if (!apiData || !apiData.extractedText || apiData.extractedText.length < 5) {
        try {
          const ocrResult = await recognize(canvas, 'eng');
          localOcrText = ocrResult.data.text ? ocrResult.data.text.trim() : '';
          console.log('[DocReader Local OCR Fallback]:', localOcrText);

          if (localOcrText && (!apiData || !apiData.extractedText)) {
            const res = await fetch('/api/analyze-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rawText: localOcrText }),
            });
            if (res.ok) {
              apiData = await res.json();
            }
          }
        } catch (ocrErr) {
          console.warn('Local Tesseract fallback error:', ocrErr);
        }
      }

      setIsProcessingOCR(false);

      const finalText = apiData?.extractedText || localOcrText;
      const finalSummary = apiData?.summary || '';
      const finalType = apiData?.documentType || 'Document';
      const finalDetails = Array.isArray(apiData?.keyDetails) ? apiData.keyDetails : [];

      if (!finalText || finalText.length < 3) {
        setStatusMessage('No clear text found. Please try again.');
        await speak(
          "I couldn't read any text clearly from this image. Please hold the document closer, ensure good lighting, and hold still."
        );
        initCamera('document');
        return;
      }

      setExtractedText(finalText);
      setSummaryText(finalSummary);
      setDocumentType(finalType);
      setKeyDetails(finalDetails);
      setMode('RESULT');
      setStatusMessage(`Document analyzed clearly: ${finalType}`);

      if (finalSummary) {
        await speakChunks(finalSummary, `${finalType} detected.`);
      } else {
        await speakChunks(finalText, 'Document reads:');
      }

      // Prompt the user to ask for summary, advantages, or disadvantages of this document
      setStatusMessage("Ask: Say 'Summary', 'Advantages', 'Disadvantages', or 'Pros and Cons'");
      await speak(
        "I have read the document. Would you like me to make a summary, or explain the advantages or disadvantages of this document? You can say summary, advantages, disadvantages, or pros and cons."
      );
    } catch (err) {
      console.error('Document processing error:', err);
      setIsProcessingOCR(false);
      setStatusMessage('Error analyzing document.');
      await speak("I encountered an error reading the document. Say 'scan document' to try again.");
      setMode('IDLE');
    }
  }, [speak, speakChunks, setStatusMessage, stopCamera, initCamera]);

  // Code scanner loop for continuous QR and Barcode detection
  useEffect(() => {
    if (mode !== 'CODE_SCANNING' || !isCameraActive) return;

    codeScanIntervalRef.current = setInterval(async () => {
      if (pendingCodeToConfirm || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const result = await detectCodeFromCanvas(canvas);
      if (result && result.data) {
        if (ignoredCodes.has(result.data)) {
          return; // Skip previously ignored code
        }

        // Found code! Pause interval scanning
        clearInterval(codeScanIntervalRef.current);
        codeScanIntervalRef.current = null;

        setPendingCodeToConfirm(result);
        setStatusMessage(`Found ${result.type} code. Say "scan it" or "ignore".`);
        speak("I found a code. Say 'scan it' to open it, or 'ignore' to keep looking.");
      }
    }, 400);

    return () => {
      if (codeScanIntervalRef.current) {
        clearInterval(codeScanIntervalRef.current);
        codeScanIntervalRef.current = null;
      }
    };
  }, [mode, isCameraActive, pendingCodeToConfirm, ignoredCodes, speak, setStatusMessage]);

  // Execute Code opening/reading
  const handleOpenCode = useCallback(async () => {
    if (!pendingCodeToConfirm) return;

    const code = pendingCodeToConfirm;
    setDetectedCode(code);
    setPendingCodeToConfirm(null);
    stopCamera();
    setMode('RESULT');

    const content = code.data;
    const isUrl = /^https?:\/\//i.test(content);

    if (isUrl) {
      setStatusMessage(`Opening link: ${content}`);
      await speak(`Opening web link ${content}`);
      window.open(content, '_blank', 'noopener,noreferrer');
    } else {
      setStatusMessage(`Code content: ${content}`);
      await speak(`The code contains the text: ${content}`);
    }
  }, [pendingCodeToConfirm, stopCamera, speak, setStatusMessage]);

  // Ignore detected code and resume scanning
  const handleIgnoreCode = useCallback(async () => {
    if (!pendingCodeToConfirm) return;

    const ignoredVal = pendingCodeToConfirm.data;
    setIgnoredCodes((prev) => new Set(prev).add(ignoredVal));
    setPendingCodeToConfirm(null);

    setStatusMessage('Ignoring code. Continuing scan...');
    await speak('Ignoring code. Continuing scan.');
  }, [pendingCodeToConfirm, speak, setStatusMessage]);

  // Execute user-told operation (Summary, Advantages, Disadvantages, or Both)
  const handleExecuteOperation = useCallback(
    async (opType: 'summary' | 'advantages' | 'disadvantages' | 'advantages_and_disadvantages') => {
      if (!extractedText && !capturedImage) {
        await speak('Please scan a document first.');
        return;
      }

      setIsAnalyzingOperation(true);
      let label = 'Summary';
      if (opType === 'advantages_and_disadvantages') label = 'Advantages & Disadvantages';
      else if (opType === 'advantages') label = 'Advantages';
      else if (opType === 'disadvantages') label = 'Disadvantages';

      setUserRequestedOperation(label);
      setStatusMessage(`Analyzing ${label}...`);
      await speak(`Analyzing ${label} for this document, please wait...`);

      try {
        const res = await fetch('/api/document-operation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: extractedText,
            imageBase64: capturedImage,
            operation: opType,
          }),
        });

        const data = await res.json();
        setIsAnalyzingOperation(false);

        if (data && data.spokenResult) {
          setOperationResult({
            title: data.operationTitle || label,
            spokenResult: data.spokenResult,
            summary: data.summary,
            advantages: data.advantages || [],
            disadvantages: data.disadvantages || [],
          });
          setStatusMessage(`Displayed Operation: ${data.operationTitle || label}`);
          await speakChunks(data.spokenResult, `${data.operationTitle || label}:`);
        } else {
          await speak('Unable to generate the requested analysis for this document.');
        }
      } catch (err) {
        console.error('Document operation error:', err);
        setIsAnalyzingOperation(false);
        await speak('An error occurred while generating the document analysis.');
      }
    },
    [extractedText, capturedImage, speak, speakChunks, setStatusMessage]
  );

  // Re-read current text or summary
  const handleReadAgain = useCallback(async () => {
    if (summaryText) {
      setStatusMessage('Reading document summary again...');
      await speakChunks(summaryText, `${documentType || 'Document'} summary:`);
    } else if (extractedText) {
      setStatusMessage('Reading extracted text again...');
      await speakChunks(extractedText, 'Document text:');
    } else if (detectedCode) {
      setStatusMessage('Reading code content again...');
      await speak(`Code contains: ${detectedCode.data}`);
    } else {
      await speak('No scan result to read. Say scan document or scan code.');
    }
  }, [extractedText, summaryText, documentType, detectedCode, speak, speakChunks, setStatusMessage]);

  const handleReadFullText = useCallback(async () => {
    if (extractedText) {
      setStatusMessage('Reading full transcribed text...');
      await speakChunks(extractedText, 'Full transcribed text:');
    } else {
      await speak('No document text available to read.');
    }
  }, [extractedText, speakChunks, setStatusMessage, speak]);

  // New Scan discard
  const handleNewScan = useCallback(async () => {
    stopCamera();
    setExtractedText(null);
    setSummaryText(null);
    setDocumentType(null);
    setKeyDetails([]);
    setCapturedImage(null);
    setUserRequestedOperation(null);
    setOperationResult(null);
    setIsAnalyzingOperation(false);
    setDetectedCode(null);
    setPendingCodeToConfirm(null);
    setMode('IDLE');
    setStatusMessage("Ready for new scan. Say 'scan document' or 'scan code'.");
    await speak("Ready for new scan. Say 'scan document' or 'scan code'.");
  }, [stopCamera, speak, setStatusMessage]);

  // Register page voice command listener
  useEffect(() => {
    const listener = (transcript: string): boolean => {
      const text = transcript.toLowerCase().replace(/[^\w\s]/gi, '').trim();
      const normalized = text
        .replace(/\b(scane|skan|scanne|scand|scanned|scanner|scanning|can|cam|ken|con|skin)\b/g, 'scan')
        .replace(/\b(doc|docs)\b/g, 'document');

      // Home / Go Back command handled with camera cleanup
      if (
        normalized.includes('home') ||
        normalized.includes('go back') ||
        normalized.includes('main menu') ||
        normalized.includes('return')
      ) {
        stopCamera();
        executeCommand('GO_BACK');
        return true;
      }

      // 1. "scan document" or "scan paper" or "scane document" / "can document"
      if (
        normalized.includes('scan document') ||
        normalized.includes('scan paper') ||
        normalized.includes('read document') ||
        normalized.includes('document scan') ||
        normalized.includes('read paper') ||
        normalized.includes('scan text') ||
        normalized.includes('scane') ||
        normalized.includes('can document')
      ) {
        initCamera('document');
        return true;
      }

      // 2. "scan code" or "scan qr" or "scan barcode"
      if (
        normalized.includes('scan code') ||
        normalized.includes('scan qr') ||
        normalized.includes('scan barcode') ||
        normalized.includes('code scan') ||
        normalized.includes('read code') ||
        normalized.includes('qr code') ||
        normalized.includes('can code')
      ) {
        initCamera('code');
        return true;
      }

      // 3. "capture" or "take photo"
      if (
        text.includes('capture') ||
        text.includes('take photo') ||
        text.includes('snap') ||
        text.includes('take picture')
      ) {
        if (mode === 'DOC_SCANNING') {
          captureDocument();
          return true;
        }
      }

      // 4. "scan it" or "open it" (for code detection)
      if (
        text.includes('scan it') ||
        text.includes('open it') ||
        text.includes('read code') ||
        text.includes('open link')
      ) {
        if (pendingCodeToConfirm) {
          handleOpenCode();
          return true;
        }
      }

      // 5. "ignore" or "skip"
      if (
        text.includes('ignore') ||
        text.includes('skip') ||
        text.includes('keep looking') ||
        text.includes('next code')
      ) {
        if (pendingCodeToConfirm) {
          handleIgnoreCode();
          return true;
        }
      }

      // 6. "advantages and disadvantages" or "pros and cons" or "both"
      if (
        text.includes('advantages and disadvantages') ||
        text.includes('advantages & disadvantages') ||
        text.includes('pros and cons') ||
        text.includes('both advantages') ||
        text.includes('advantages disadvantages') ||
        text.includes('pro and con')
      ) {
        handleExecuteOperation('advantages_and_disadvantages');
        return true;
      }

      // 7. "disadvantages" or "cons" or "risks" or "drawbacks"
      if (
        text.includes('disadvantage') ||
        text.includes('disadvantages') ||
        text.includes('cons') ||
        text.includes('drawback') ||
        text.includes('drawbacks') ||
        text.includes('risk') ||
        text.includes('risks')
      ) {
        handleExecuteOperation('disadvantages');
        return true;
      }

      // 8. "advantages" or "pros" or "benefits"
      if (
        text.includes('advantage') ||
        text.includes('advantages') ||
        text.includes('pros') ||
        text.includes('benefit') ||
        text.includes('benefits')
      ) {
        handleExecuteOperation('advantages');
        return true;
      }

      // 9. "summary" or "make summary" or "give summary"
      if (
        text.includes('make summary') ||
        text.includes('give summary') ||
        text.includes('summarize') ||
        text.includes('generate summary') ||
        text.includes('create summary')
      ) {
        handleExecuteOperation('summary');
        return true;
      }

      // 10. "read full text" or "read text"
      if (
        text.includes('read full text') ||
        text.includes('read text') ||
        text.includes('full text') ||
        text.includes('read all')
      ) {
        handleReadFullText();
        return true;
      }

      // 11. "read again" or "repeat" or "read summary"
      if (
        text.includes('read again') ||
        text.includes('repeat') ||
        text.includes('read summary') ||
        text.includes('say again')
      ) {
        handleReadAgain();
        return true;
      }

      // 12. "new scan" or "start over" or "clear"
      if (
        text.includes('new scan') ||
        text.includes('rescan') ||
        text.includes('start over') ||
        text.includes('clear scan') ||
        text.includes('discard')
      ) {
        handleNewScan();
        return true;
      }

      return false; // Not handled by page, let global handlers manage
    };

    const unregister = registerCommandListener(listener);
    return () => {
      unregister();
    };
  }, [
    registerCommandListener,
    initCamera,
    captureDocument,
    pendingCodeToConfirm,
    handleOpenCode,
    handleIgnoreCode,
    handleReadAgain,
    handleReadFullText,
    handleExecuteOperation,
    handleNewScan,
    stopCamera,
    executeCommand,
    mode,
  ]);

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-8 sm:px-8 space-y-8">
      {/* Voice Status Card */}
      <VoiceStatusCard />

      {/* Hidden Canvas for Frame Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Primary Interaction Area */}
      <section className="bg-zinc-900 border-4 border-zinc-700 hover:border-yellow-500 rounded-[32px] p-6 sm:p-10 space-y-8 shadow-[0_10px_40px_rgba(0,0,0,0.6)] transition-all">
        {/* Header Title */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-zinc-800 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-yellow-500 text-black rounded-2xl flex items-center justify-center font-black shadow-lg">
              <FileText className="w-10 h-10 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tight">
                Document Reader
              </h1>
              <p className="text-yellow-500 font-bold text-sm sm:text-base uppercase tracking-wider">
                Voice-Guided OCR & Code Scanner
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                stopCamera();
                executeCommand('GO_BACK');
              }}
              className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-black text-base uppercase tracking-wider rounded-xl border border-zinc-600 transition-all flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[3]" />
              <span>Home</span>
            </button>
          </div>
        </div>

        {/* Camera Error Message */}
        {cameraError && (
          <div className="p-4 bg-red-950/80 border-2 border-red-500 rounded-2xl flex items-center gap-3 text-red-200">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
            <p className="font-bold text-base">{cameraError}</p>
          </div>
        )}

        {/* Live Camera Feed Preview */}
        {(mode === 'DOC_SCANNING' || mode === 'CODE_SCANNING') && (
          <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden border-4 border-yellow-500 shadow-2xl flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Visual Overlays for Sighted Helpers */}
            <div className="absolute inset-0 border-[6px] border-yellow-500/40 pointer-events-none m-6 rounded-2xl flex items-center justify-center">
              <div className="px-6 py-3 bg-black/80 backdrop-blur-md rounded-full border-2 border-yellow-500 text-yellow-400 font-black text-lg uppercase tracking-wider animate-pulse flex items-center gap-3">
                <Camera className="w-6 h-6 animate-spin" />
                <span>
                  {mode === 'DOC_SCANNING'
                    ? "Say 'capture' or hold steady"
                    : 'Scanning for QR/Barcode...'}
                </span>
              </div>
            </div>

            {/* Code Detection Confirmation Banner */}
            {pendingCodeToConfirm && (
              <div className="absolute bottom-6 left-6 right-6 p-6 bg-yellow-500 text-black rounded-2xl border-4 border-black shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-bounce">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-10 h-10 stroke-[3] shrink-0" />
                  <div>
                    <h3 className="font-black text-xl uppercase">
                      Code Detected ({pendingCodeToConfirm.type})
                    </h3>
                    <p className="font-bold text-base truncate max-w-md">
                      {pendingCodeToConfirm.data}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={handleOpenCode}
                    className="flex-1 sm:flex-initial px-6 py-3 bg-black text-white font-black text-base uppercase rounded-xl hover:bg-zinc-800 transition-all cursor-pointer"
                  >
                    Say "Scan It"
                  </button>
                  <button
                    onClick={handleIgnoreCode}
                    className="flex-1 sm:flex-initial px-6 py-3 bg-zinc-800 text-white font-black text-base uppercase rounded-xl hover:bg-zinc-700 transition-all cursor-pointer"
                  >
                    Say "Ignore"
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading Spinner for OCR / Summarization */}
        {(isProcessingOCR || isSummarizing) && (
          <div className="p-8 bg-zinc-950 border-2 border-yellow-500/50 rounded-3xl text-center space-y-6 shadow-inner">
            <Loader2 className="w-12 h-12 text-yellow-500 animate-spin mx-auto" />
            <p className="text-xl font-black text-yellow-400 uppercase tracking-wide">
              {isProcessingOCR ? 'Analyzing document image with AI vision...' : 'Analyzing document summary...'}
            </p>
            {capturedImage && (
              <div className="max-w-md mx-auto rounded-2xl overflow-hidden border-2 border-yellow-500/40 shadow-xl bg-black">
                <img src={capturedImage} alt="Captured Document" className="w-full object-contain max-h-64" />
              </div>
            )}
          </div>
        )}

        {/* Scan Results Display */}
        {mode === 'RESULT' && (
          <div className="space-y-6">
            {/* Captured Document Preview & Document Classification Badge */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              {documentType && (
                <div className="flex items-center gap-3 bg-yellow-500 text-black px-5 py-3 rounded-2xl font-black text-lg uppercase tracking-wider shadow-lg w-fit">
                  <FileText className="w-6 h-6 stroke-[3]" />
                  <span>Type: {documentType}</span>
                </div>
              )}
            </div>

            {capturedImage && (
              <div className="p-4 bg-zinc-950 border-2 border-zinc-800 rounded-3xl space-y-3">
                <div className="flex items-center gap-2 text-zinc-400 font-bold text-sm uppercase tracking-wider">
                  <Camera className="w-4 h-4 text-yellow-500" />
                  <span>Scanned Document Image</span>
                </div>
                <div className="max-w-md mx-auto rounded-2xl overflow-hidden border border-zinc-700 bg-black shadow-md">
                  <img src={capturedImage} alt="Scanned Document Preview" className="w-full object-contain max-h-64" />
                </div>
              </div>
            )}

            {/* AI Summary Card */}
            {summaryText && (
              <div className="p-6 bg-yellow-500/10 border-2 border-yellow-500 rounded-3xl space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-yellow-500/30 pb-3">
                  <div className="flex items-center gap-2 text-yellow-400 font-black text-lg sm:text-xl uppercase tracking-wider">
                    <Sparkles className="w-6 h-6" />
                    <span>AI Document Analysis & Summary</span>
                  </div>
                  <button
                    onClick={handleReadAgain}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-sm uppercase rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow"
                  >
                    <Volume2 className="w-4 h-4 stroke-[3]" />
                    <span>Read Summary</span>
                  </button>
                </div>
                <p className="text-yellow-100 text-lg sm:text-2xl font-semibold leading-relaxed">
                  {summaryText}
                </p>
              </div>
            )}

            {/* Document Operations Bar (User Told Operations) */}
            {extractedText && (
              <div className="p-6 bg-zinc-950 border-2 border-yellow-500/80 rounded-3xl space-y-4 shadow-xl">
                <div className="flex items-center gap-2 text-yellow-400 font-black text-lg sm:text-xl uppercase tracking-wider">
                  <Sparkles className="w-6 h-6" />
                  <span>Document Analysis Operations</span>
                </div>
                <p className="text-zinc-300 font-bold text-base">
                  Say or click what analysis you want to perform on this document:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <button
                    onClick={() => handleExecuteOperation('summary')}
                    disabled={isAnalyzingOperation}
                    className="p-4 bg-zinc-900 hover:bg-zinc-800 text-yellow-400 font-black text-sm uppercase rounded-2xl border-2 border-yellow-500/40 hover:border-yellow-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow disabled:opacity-50"
                  >
                    <Sparkles className="w-5 h-5 text-yellow-500" />
                    <span>Make Summary</span>
                  </button>

                  <button
                    onClick={() => handleExecuteOperation('advantages')}
                    disabled={isAnalyzingOperation}
                    className="p-4 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 font-black text-sm uppercase rounded-2xl border-2 border-emerald-500/40 hover:border-emerald-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow disabled:opacity-50"
                  >
                    <ThumbsUp className="w-5 h-5 text-emerald-400" />
                    <span>Advantages</span>
                  </button>

                  <button
                    onClick={() => handleExecuteOperation('disadvantages')}
                    disabled={isAnalyzingOperation}
                    className="p-4 bg-zinc-900 hover:bg-zinc-800 text-rose-400 font-black text-sm uppercase rounded-2xl border-2 border-rose-500/40 hover:border-rose-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow disabled:opacity-50"
                  >
                    <ThumbsDown className="w-5 h-5 text-rose-400" />
                    <span>Disadvantages</span>
                  </button>

                  <button
                    onClick={() => handleExecuteOperation('advantages_and_disadvantages')}
                    disabled={isAnalyzingOperation}
                    className="p-4 bg-zinc-900 hover:bg-zinc-800 text-amber-300 font-black text-sm uppercase rounded-2xl border-2 border-amber-500/40 hover:border-amber-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow disabled:opacity-50"
                  >
                    <Scale className="w-5 h-5 text-amber-400" />
                    <span>Pros & Cons</span>
                  </button>
                </div>
              </div>
            )}

            {/* Operation Loading State */}
            {isAnalyzingOperation && (
              <div className="p-6 bg-zinc-950 border-2 border-yellow-500/60 rounded-3xl text-center space-y-3">
                <Loader2 className="w-8 h-8 text-yellow-500 animate-spin mx-auto" />
                <p className="text-yellow-400 font-black text-lg uppercase tracking-wider">
                  Generating {userRequestedOperation || 'requested analysis'}...
                </p>
              </div>
            )}

            {/* User-Requested Operation Result Card */}
            {operationResult && !isAnalyzingOperation && (
              <div className="p-6 bg-zinc-950 border-2 border-yellow-400 rounded-3xl space-y-6 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-4 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-yellow-500 text-black font-black text-xs uppercase tracking-widest rounded-lg">
                      User Operation Told
                    </span>
                    <h3 className="text-white font-black text-xl sm:text-2xl uppercase tracking-wider">
                      {operationResult.title}
                    </h3>
                  </div>
                  <button
                    onClick={() => speakChunks(operationResult.spokenResult, `${operationResult.title}:`)}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-sm uppercase rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow"
                  >
                    <Volume2 className="w-4 h-4 stroke-[3]" />
                    <span>Read Result Aloud</span>
                  </button>
                </div>

                <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
                  <p className="text-yellow-100 text-lg sm:text-xl font-semibold leading-relaxed">
                    {operationResult.spokenResult}
                  </p>
                </div>

                {operationResult.advantages && operationResult.advantages.length > 0 && (
                  <div className="p-5 bg-emerald-950/40 border-2 border-emerald-500/50 rounded-2xl space-y-3">
                    <div className="flex items-center gap-2 text-emerald-400 font-black text-lg uppercase tracking-wider">
                      <ThumbsUp className="w-5 h-5" />
                      <span>Key Advantages ({operationResult.advantages.length})</span>
                    </div>
                    <ul className="space-y-2">
                      {operationResult.advantages.map((adv, i) => (
                        <li key={i} className="flex items-start gap-3 text-emerald-100 font-bold text-base sm:text-lg">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{adv}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {operationResult.disadvantages && operationResult.disadvantages.length > 0 && (
                  <div className="p-5 bg-rose-950/40 border-2 border-rose-500/50 rounded-2xl space-y-3">
                    <div className="flex items-center gap-2 text-rose-400 font-black text-lg uppercase tracking-wider">
                      <ThumbsDown className="w-5 h-5" />
                      <span>Key Disadvantages ({operationResult.disadvantages.length})</span>
                    </div>
                    <ul className="space-y-2">
                      {operationResult.disadvantages.map((dis, i) => (
                        <li key={i} className="flex items-start gap-3 text-rose-100 font-bold text-base sm:text-lg">
                          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                          <span>{dis}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Key Fact Details */}
            {keyDetails && keyDetails.length > 0 && (
              <div className="p-6 bg-zinc-950 border-2 border-zinc-700 rounded-3xl space-y-4">
                <h3 className="text-yellow-500 font-black text-lg uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                  <span>Key Facts & Action Items</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {keyDetails.map((detail, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white font-bold text-base flex items-center gap-2"
                    >
                      <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                      <span>{detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted Transcribed Text */}
            {extractedText && (
              <div className="p-6 bg-zinc-950 border-2 border-zinc-700 rounded-3xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2 text-zinc-300 font-black text-lg uppercase tracking-wider">
                    <FileText className="w-6 h-6 text-yellow-500" />
                    <span>Transcribed Document Text</span>
                  </div>
                  <button
                    onClick={handleReadFullText}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm uppercase rounded-xl border border-zinc-600 flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Volume2 className="w-4 h-4 text-yellow-500" />
                    <span>Read Full Text</span>
                  </button>
                </div>
                <p className="text-white text-lg sm:text-xl font-medium leading-relaxed whitespace-pre-wrap select-text">
                  {extractedText}
                </p>
              </div>
            )}

            {/* Code Content Result */}
            {detectedCode && (
              <div className="p-6 bg-zinc-950 border-2 border-yellow-500 rounded-3xl space-y-4">
                <div className="flex items-center gap-2 text-yellow-500 font-black text-lg uppercase tracking-wider">
                  <QrCode className="w-6 h-6" />
                  <span>Code Detected ({detectedCode.type})</span>
                </div>
                <p className="text-white text-xl font-mono break-all bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                  {detectedCode.data}
                </p>
                {/^https?:\/\//i.test(detectedCode.data) && (
                  <a
                    href={detectedCode.data}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-yellow-500 text-black font-black text-base uppercase rounded-xl hover:bg-yellow-400 transition-all"
                  >
                    <ExternalLink className="w-5 h-5 stroke-[3]" />
                    <span>Open Web Link</span>
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Controls & Voice Command Shortcuts */}
        <div className="pt-4 border-t-2 border-zinc-800 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => initCamera('document')}
              className="p-6 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xl uppercase tracking-wider rounded-2xl transition-all shadow-xl flex items-center justify-center gap-3 cursor-pointer"
            >
              <Camera className="w-8 h-8 stroke-[3]" />
              <span>Scan Document</span>
            </button>

            <button
              onClick={() => initCamera('code')}
              className="p-6 bg-zinc-800 hover:bg-zinc-700 text-white font-black text-xl uppercase tracking-wider rounded-2xl transition-all border-2 border-zinc-600 flex items-center justify-center gap-3 cursor-pointer"
            >
              <QrCode className="w-8 h-8 text-yellow-500 stroke-[2.5]" />
              <span>Scan Code</span>
            </button>
          </div>

          {/* Contextual Secondary Voice Commands */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {mode === 'DOC_SCANNING' && (
              <button
                onClick={captureDocument}
                className="px-6 py-3 bg-white text-black font-black text-lg uppercase rounded-xl hover:bg-zinc-200 transition-all flex items-center gap-2 cursor-pointer shadow-lg"
              >
                <Camera className="w-5 h-5 stroke-[3]" />
                <span>Say "Capture"</span>
              </button>
            )}

            {mode === 'RESULT' && (
              <>
                <button
                  onClick={handleReadAgain}
                  className="px-5 py-3 bg-zinc-800 text-white font-black text-base uppercase rounded-xl border border-zinc-600 hover:bg-zinc-700 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Volume2 className="w-5 h-5 text-yellow-500" />
                  <span>Say "Read Again"</span>
                </button>
                <button
                  onClick={handleNewScan}
                  className="px-5 py-3 bg-zinc-800 text-white font-black text-base uppercase rounded-xl border border-zinc-600 hover:bg-zinc-700 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-5 h-5 text-yellow-500" />
                  <span>Say "New Scan"</span>
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
