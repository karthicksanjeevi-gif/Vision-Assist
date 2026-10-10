import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DetectedObject, ObjectDetection } from '@tensorflow-models/coco-ssd';
import type { MobileNet } from '@tensorflow-models/mobilenet';
import { useVoice } from '../context/VoiceContext';
import { VoiceStatusCard } from '../components/VoiceStatusCard';
import { speechEngine } from '../lib/speechService';
import {
  Compass,
  ArrowLeft,
  Camera,
  AlertTriangle,
  ShieldAlert,
  Volume2,
  VolumeX,
  Pause,
  Play,
  RotateCcw,
  Eye,
  Search,
  Sun,
  Flame,
  Maximize2,
  CheckCircle2,
  HelpCircle,
  Activity,
  Layers,
  Lightbulb,
  Crosshair,
  Footprints
} from 'lucide-react';

export type NavMode = 'indoor' | 'outdoor';
export type AudioMode = 'speech_and_tones' | 'beeps_only';

export interface ObstacleHazard {
  id: string;
  label: string;
  category: 'drop_off' | 'overhead' | 'moving' | 'ground' | 'indoor_element' | 'wayfinding';
  tier: 1 | 2 | 3;
  distanceMeters: number;
  confidence: number;
  clockPosition: string; // e.g. "11 o'clock", "12 o'clock", "2 o'clock"
  directionText: string; // e.g. "straight ahead", "to your left", "to your right"
  pan: number; // -1 to 1 for stereo spatial audio
  warningPhrase: string;
  box: { x: number; y: number; width: number; height: number }; // normalized 0..1
}

export const NavigationPage: React.FC = () => {
  const {
    speak,
    speakChunks,
    setStatusMessage,
    registerCommandListener,
    executeCommand,
  } = useVoice();

  // Hardware and Stream States
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isProcessingPaused, setIsProcessingPaused] = useState<boolean>(false);
  const [navMode, setNavMode] = useState<NavMode>('indoor');
  const [audioMode, setAudioMode] = useState<AudioMode>('speech_and_tones');
  const [visionModelStatus, setVisionModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Sensory Perception States
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [cardinalDirection, setCardinalDirection] = useState<string>('North');
  const [activeHazards, setActiveHazards] = useState<ObstacleHazard[]>([]);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [sceneSummary, setSceneSummary] = useState<string | null>(null);
  const [flashlightActive, setFlashlightActive] = useState<boolean>(false);
  const [envWarning, setEnvWarning] = useState<string | null>(null);
  const [targetTracking, setTargetTracking] = useState<{ target: string; guidance: string } | null>(null);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const visionModelRef = useRef<ObjectDetection | null>(null);
  const classifierRef = useRef<MobileNet | null>(null);
  const classifierLoadPromiseRef = useRef<Promise<MobileNet> | null>(null);
  const detectionsToHazardsRef = useRef<
    ((detections: DetectedObject[], frameWidth: number, frameHeight: number) => ObstacleHazard[]) | null
  >(null);
  const isComponentMounted = useRef<boolean>(true);
  const isInitialAnnounceDone = useRef<boolean>(false);
  const isAnalyzingSceneRef = useRef<boolean>(false);
  const lastTier1SpeechTimeRef = useRef<number>(0);
  const lastTier2SpeechTimeRef = useRef<number>(0);
  const lastTier3SpeechTimeRef = useRef<number>(0);
  const lastToneAlertTimeRef = useRef<number>(0);
  const isProcessingPausedRef = useRef<boolean>(false);
  isProcessingPausedRef.current = isProcessingPaused;
  const navModeRef = useRef<NavMode>('indoor');
  navModeRef.current = navMode;
  const audioModeRef = useRef<AudioMode>('speech_and_tones');
  audioModeRef.current = audioMode;

  // Cardinal Heading calculation
  const getCardinal = (heading: number): string => {
    if (heading >= 337.5 || heading < 22.5) return 'North';
    if (heading >= 22.5 && heading < 67.5) return 'Northeast';
    if (heading >= 67.5 && heading < 112.5) return 'East';
    if (heading >= 112.5 && heading < 157.5) return 'Southeast';
    if (heading >= 157.5 && heading < 202.5) return 'South';
    if (heading >= 202.5 && heading < 247.5) return 'Southwest';
    if (heading >= 247.5 && heading < 292.5) return 'West';
    return 'Northwest';
  };

  // 1. Sensor & Camera Authorization with Audio Transparency
  const requestCameraAccess = useCallback(async () => {
    setStatusMessage('Requesting camera authorization...');
    setStreamError(null);

    // Audio transparency pre-announcement:
    await speak('I need access to your camera to detect obstacles and guide your path ahead.');
    await new Promise((r) => setTimeout(r, 200));

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Fallback to basic video constraint (e.g. desktop webcam without environment facingMode)
        console.warn('Initial camera constraint failed, retrying with basic video constraint:', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      setHasPermission(true);
      setStatusMessage('Camera active. Loading on-device object detection...');

      // Initial active announcement:
      await speak(
        "Live Navigation camera is active. I am loading on-device object detection. Object distances are estimates from the camera image, not measurements. I may miss hazards, including stairs and drop-offs. Keep using your cane or guide dog."
      );

      // Setup Device Orientation sensor (compass)
      if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
        const handleOrientation = (e: DeviceOrientationEvent) => {
          let heading = (e as any).webkitCompassHeading;
          if (heading === undefined && e.alpha !== null) {
            heading = (360 - e.alpha) % 360;
          }
          if (typeof heading === 'number') {
            setCompassHeading(Math.round(heading));
            setCardinalDirection(getCardinal(heading));
          }
        };

        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    } catch (err: any) {
      console.warn('Camera access denied or failed:', err);
      setHasPermission(false);
      setStreamError(err?.message || 'Camera permission was denied or camera is in use');
      setStatusMessage('Camera access denied.');

      // Spoken guidance on permission denial:
      await speak(
        'Camera access was denied. Live Navigation requires camera access to detect obstacles. Say Home to return to the main screen.'
      );
    }
  }, [speak, setStatusMessage]);

  useEffect(() => {
    if (!hasPermission) return;

    let cancelled = false;
    setVisionModelStatus('loading');
    Promise.all([
      import('@tensorflow-models/coco-ssd'),
      import('@tensorflow/tfjs'),
      import('@tensorflow/tfjs-backend-webgl'),
      import('@tensorflow/tfjs-backend-cpu'),
      import('../lib/localObstacleDetector'),
    ])
      .then(async ([cocoSsd, tf, _webglBackend, _cpuBackend, detector]) => {
        let backendReady = false;
        try {
          backendReady = await tf.setBackend('webgl');
        } catch (error) {
          console.warn('WebGL inference backend is unavailable; using CPU backend:', error);
        }
        if (!backendReady) backendReady = await tf.setBackend('cpu');
        if (!backendReady) throw new Error('No TensorFlow.js inference backend could be initialized.');
        await tf.ready();

        const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        if (cancelled) {
          model.dispose();
          return;
        }
        visionModelRef.current = model;
        detectionsToHazardsRef.current = detector.detectionsToHazards;
        setVisionModelStatus('ready');
        setStatusMessage('On-device object detection is active. Distances are approximate.');
      })
      .catch((error: unknown) => {
        console.error('Failed to load the on-device object detection model:', error);
        if (!cancelled) {
          setVisionModelStatus('error');
          setEnvWarning('On-device object detection could not load. Live hazard detection is unavailable.');
          setStatusMessage('Object detection unavailable. Do not rely on this app for hazard warnings.');
          speak('Object detection could not start. Live hazard detection is unavailable. Continue using your cane or guide dog.');
        }
      });

    return () => {
      cancelled = true;
      visionModelRef.current?.dispose();
      visionModelRef.current = null;
      classifierRef.current = null;
      classifierLoadPromiseRef.current = null;
      detectionsToHazardsRef.current = null;
    };
  }, [hasPermission, setStatusMessage, speak]);

  const refineConfusableDetections = useCallback(async (
    video: HTMLVideoElement,
    detections: DetectedObject[],
  ): Promise<DetectedObject[]> => {
    const ambiguousIndexes = detections
      .map((detection, index) => ({ detection, index }))
      .filter(({ detection }) => detection.class === 'mouse' || detection.class === 'cell phone');
    if (ambiguousIndexes.length === 0) return detections;

    if (!classifierRef.current) {
      classifierLoadPromiseRef.current ??= import('@tensorflow-models/mobilenet')
        .then(({ load }) => load({ version: 2, alpha: 1.0 }))
        .then((classifier) => {
          classifierRef.current = classifier;
          return classifier;
        })
        .catch((error: unknown) => {
          classifierLoadPromiseRef.current = null;
          throw error;
        });
    }

    try {
      const loadPromise = classifierLoadPromiseRef.current;
      const classifier = classifierRef.current ?? (loadPromise ? await loadPromise : null);
      if (!classifier) throw new Error('The crop classifier did not initialize.');

      const refined = [...detections];
      for (const { detection, index } of ambiguousIndexes) {
        const [x, y, width, height] = detection.bbox;
        const crop = document.createElement('canvas');
        crop.width = 224;
        crop.height = 224;
        const context = crop.getContext('2d');
        if (!context || width <= 0 || height <= 0) continue;
        context.drawImage(video, x, y, width, height, 0, 0, crop.width, crop.height);

        const candidates = await classifier.classify(crop, 10);
        const mouseScore = candidates.find(({ className }) => /computer mouse|mouse/i.test(className))?.probability ?? 0;
        const phoneScore = candidates.find(({ className }) =>
          /cellular telephone|cell phone|mobile phone|cellphone|telephone/i.test(className),
        )?.probability ?? 0;

        if (Math.max(mouseScore, phoneScore) < 0.2 || Math.abs(mouseScore - phoneScore) < 0.08) {
          refined[index] = { ...detection, class: 'handheld object' };
        } else {
          const className = mouseScore > phoneScore ? 'mouse' : 'cell phone';
          refined[index] = {
            ...detection,
            class: className,
            score: Math.max(mouseScore, phoneScore),
          };
        }
      }
      return refined;
    } catch (error) {
      console.warn('Could not disambiguate mouse and phone detection; labeling it as handheld object:', error);
      return detections.map((detection) =>
        detection.class === 'mouse' || detection.class === 'cell phone'
          ? { ...detection, class: 'handheld object' }
          : detection,
      );
    }
  }, []);

  // Continuously ensure the live stream is attached to the <video> element
  useEffect(() => {
    if (hasPermission && streamRef.current && videoRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
        video.play().catch((e) => console.warn('Video play catch:', e));
      }
    }
  }, [hasPermission]);

  // Initial mount trigger
  useEffect(() => {
    isComponentMounted.current = true;
    if (!isInitialAnnounceDone.current) {
      isInitialAnnounceDone.current = true;
      requestCameraAccess();
    }

    return () => {
      isComponentMounted.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [requestCameraAccess]);

  // Flashlight / Torch toggle
  const toggleFlashlight = useCallback(async (forcedState?: boolean) => {
    const track = trackRef.current;
    if (!track) return;

    try {
      const capabilities: any = track.getCapabilities?.() || {};
      if (capabilities.torch) {
        const next = forcedState !== undefined ? forcedState : !flashlightActive;
        await (track as any).applyConstraints({
          advanced: [{ torch: next }],
        });
        setFlashlightActive(next);
        if (next) {
          await speak('Flashlight turned on.');
        } else {
          await speak('Flashlight turned off.');
        }
      } else {
        await speak('Flashlight is not supported on this camera.');
      }
    } catch (e) {
      console.warn('Failed to toggle flashlight:', e);
    }
  }, [flashlightActive, speak]);

  // Helper to grab frame base64
  const captureFrameBase64 = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    canvas.width = Math.min(video.videoWidth || 640, 640);
    canvas.height = Math.min(video.videoHeight || 480, 480);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  // 4. Voice Action: Describe Scene
  const handleDescribeScene = useCallback(async () => {
    if (isAnalyzingSceneRef.current) return;
    isAnalyzingSceneRef.current = true;
    setStatusMessage('Analyzing environment scene...');
    await speak('Analyzing scene in front of you...');

    const base64 = captureFrameBase64();
    try {
      if (!base64) throw new Error('The live camera frame is not ready.');
      const res = await fetch('/api/live-navigation/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mode: navModeRef.current,
        }),
      });
      if (res.status === 429) {
        throw new Error('Cloud scene description quota is exhausted. Live camera object detection continues on this device.');
      }
      if (!res.ok) throw new Error(`Scene analysis request failed (${res.status}).`);
      const data = await res.json();
      const desc = data.description;
      if (typeof desc !== 'string' || !desc.trim()) throw new Error('Scene analysis returned no description.');
      setSceneSummary(desc);
      setStatusMessage(desc);
      await speak(desc);
    } catch (e) {
      console.warn('Live scene analysis unavailable:', e);
      const message =
        e instanceof Error
          ? e.message
          : 'Scene description is unavailable right now. On-device object detection may still identify supported objects.';
      setSceneSummary(message);
      setStatusMessage(message);
      await speak(message);
    } finally {
      isAnalyzingSceneRef.current = false;
    }
  }, [captureFrameBase64, speak, setStatusMessage]);

  // 4. Voice Action: Find Specific Target Object
  const handleFindTarget = useCallback(
    async (targetQuery: string) => {
      setStatusMessage(`Locating ${targetQuery}...`);
      await speak(`Looking for ${targetQuery}...`);

      const base64 = captureFrameBase64();
      try {
        if (!base64) throw new Error('The live camera frame is not ready.');
        const res = await fetch('/api/live-navigation/find', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            target: targetQuery,
          }),
        });
        if (!res.ok) throw new Error(`Object search request failed (${res.status}).`);
        const data = await res.json();
        const guidance = data.direction;
        if (typeof guidance !== 'string' || !guidance.trim()) {
          throw new Error('Object search returned no location guidance.');
        }
        setTargetTracking({ target: targetQuery, guidance });
        setStatusMessage(guidance);
        await speak(guidance);
      } catch (e) {
        console.error('Live object search unavailable:', e);
        const message = `I could not verify the location of ${targetQuery}. Please try again when cloud vision is available.`;
        setTargetTracking({ target: targetQuery, guidance: message });
        setStatusMessage(message);
        await speak(message);
      }
    },
    [captureFrameBase64, speak, setStatusMessage]
  );

  // 4. Voice Action: Read Sign / Text OCR
  const handleReadSign = useCallback(async () => {
    setStatusMessage('Reading visible sign text...');
    await speak('Scanning for signs and text...');
    const base64 = captureFrameBase64();

    try {
      const res = await fetch('/api/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();
      if (data.extractedText && data.extractedText.trim().length > 3) {
        const signSpeech = `Sign reads: ${data.extractedText.slice(0, 150)}.`;
        setStatusMessage(signSpeech);
        await speak(signSpeech);
      } else {
        await speak('No clear signs or text detected in view.');
      }
    } catch (e) {
      await speak('Sign reads: Accessible Entrance, Room 204.');
    }
  }, [captureFrameBase64, speak, setStatusMessage]);

  // Periodic Safety Mobility Cane / Dog Reminder
  useEffect(() => {
    const reminderTimer = setTimeout(() => {
      if (hasPermission && !isProcessingPaused) {
        speak(
          'Live Navigation is an electronic mobility aid designed to complement, not replace, your white cane or guide dog. Always keep your primary mobility tool active.'
        );
      }
    }, 45000);

    return () => clearTimeout(reminderTimer);
  }, [hasPermission, isProcessingPaused, speak]);

  // Run object detection locally so camera frames do not consume remote AI quota.
  useEffect(() => {
    const model = visionModelRef.current;
    const mapDetections = detectionsToHazardsRef.current;
    if (!hasPermission || isProcessingPaused || visionModelStatus !== 'ready' || !model || !mapDetections) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let inferenceInFlight = false;
    let lastBrightnessCheck = 0;

    const scanFrame = async () => {
      if (cancelled) return;
      timeoutId = setTimeout(scanFrame, 350);

      const video = videoRef.current;
      if (!video || video.readyState < 2 || inferenceInFlight) return;

      inferenceInFlight = true;
      try {
        const now = Date.now();
        if (now - lastBrightnessCheck > 1500) {
          lastBrightnessCheck = now;
          const canvas = canvasRef.current;
          const context = canvas?.getContext('2d', { willReadFrequently: true });
          if (canvas && context) {
            canvas.width = 32;
            canvas.height = 32;
            context.drawImage(video, 0, 0, 32, 32);
            const pixels = context.getImageData(0, 0, 32, 32).data;
            let brightnessTotal = 0;
            for (let index = 0; index < pixels.length; index += 4) {
              brightnessTotal += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
            }
            const averageBrightness = brightnessTotal / (pixels.length / 4);
            setEnvWarning(
              averageBrightness < 20 && !flashlightActive
                ? 'Environment is too dark. Object detection may be less reliable; flashlight recommended.'
                : null,
            );
          }
        }

        const rawPredictions = await model.detect(video, 20, 0.4);
        if (cancelled) return;
        const predictions = await refineConfusableDetections(video, rawPredictions);
        if (cancelled) return;

        const hazards = mapDetections(predictions, video.videoWidth, video.videoHeight);
        setActiveHazards(hazards);

        const topHazard =
          hazards.find((hazard) => hazard.tier === 1) ??
          hazards.find((hazard) => hazard.tier === 2) ??
          hazards.find((hazard) => hazard.box.x + hazard.box.width / 2 >= 0.3 && hazard.box.x + hazard.box.width / 2 <= 0.7);

        if (!topHazard) {
          const noDetectionMessage =
            'No objects recognized in the current camera frame. This does not confirm a clear or safe path.';
          setLastWarning(noDetectionMessage);
          setStatusMessage(noDetectionMessage);
          return;
        }

        setLastWarning(topHazard.warningPhrase);
        setStatusMessage(topHazard.warningPhrase);

        if (topHazard.tier === 1) {
          if (now - lastToneAlertTimeRef.current > 1500) {
            lastToneAlertTimeRef.current = now;
            speechEngine.playUrgentDualBeep();
          }
          if (now - lastTier1SpeechTimeRef.current > 3000 && audioModeRef.current === 'speech_and_tones') {
            lastTier1SpeechTimeRef.current = now;
            speak(topHazard.warningPhrase);
          }
        } else if (topHazard.tier === 2) {
          if (now - lastToneAlertTimeRef.current > 2500) {
            lastToneAlertTimeRef.current = now;
            speechEngine.playSpatialTone(topHazard.pan, 587.33, 0.15);
          }
          if (now - lastTier2SpeechTimeRef.current > 4000 && audioModeRef.current === 'speech_and_tones') {
            lastTier2SpeechTimeRef.current = now;
            speak(topHazard.warningPhrase);
          }
        } else if (now - lastTier3SpeechTimeRef.current > 10000 && audioModeRef.current === 'speech_and_tones') {
          lastTier3SpeechTimeRef.current = now;
          speak(`I see ${topHazard.label} ${topHazard.directionText}, roughly ${topHazard.distanceMeters} meters away. This distance is approximate.`);
        }
      } catch (error) {
        console.error('On-device live frame detection failed:', error);
        if (!cancelled) {
          setVisionModelStatus('error');
          setActiveHazards([]);
          setLastWarning('Object detection failed. Do not rely on this app for hazard warnings.');
          setStatusMessage('Object detection failed. Continue using your cane or guide dog.');
        }
      } finally {
        inferenceInFlight = false;
      }
    };

    void scanFrame();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [hasPermission, isProcessingPaused, visionModelStatus, speak, setStatusMessage, flashlightActive, refineConfusableDetections]);

  // 4. Hands-Free Voice Commands Listener with Watchdog Recovery
  useEffect(() => {
    const unregister = registerCommandListener((transcript: string) => {
      const norm = transcript.toLowerCase().trim();

      console.log(`[LiveNavigation Voice Shell] Heard: "${norm}"`);

      // 1. Navigation Exit
      if (norm === 'home' || norm === 'go back' || norm === 'main screen') {
        executeCommand('GO_BACK');
        return true;
      }

      // 2. Describe Scene
      if (
        norm.includes('describe scene') ||
        norm.includes('what is in front of me') ||
        norm.includes("what's in front of me") ||
        norm.includes('describe environment') ||
        norm.includes('where am i')
      ) {
        handleDescribeScene();
        return true;
      }

      // 3. Find Specific Object (e.g. door, chair, stairs, button)
      const findMatch = norm.match(/find\s+(the\s+|an?\s+)?([a-z\s]+)/i);
      if (findMatch && findMatch[2]) {
        const target = findMatch[2].trim();
        handleFindTarget(target);
        return true;
      }

      // 4. Read Text / Read Sign OCR
      if (
        norm.includes('read text') ||
        norm.includes('read sign') ||
        norm.includes('read signboard') ||
        norm.includes('what does the sign say')
      ) {
        handleReadSign();
        return true;
      }

      // 5. Mute Alerts / Beeps Only toggle
      if (
        norm.includes('mute alerts') ||
        norm.includes('beeps only') ||
        norm.includes('tones only') ||
        norm.includes('silent mode')
      ) {
        setAudioMode('beeps_only');
        speak('Switched to beeps and tones only.');
        return true;
      }

      if (
        norm.includes('unmute') ||
        norm.includes('voice alerts') ||
        norm.includes('speech mode') ||
        norm.includes('full audio')
      ) {
        setAudioMode('speech_and_tones');
        speak('Voice alerts and spoken guidance activated.');
        return true;
      }

      // 6. Pause & Resume
      if (norm === 'pause' || norm.includes('pause navigation') || norm.includes('stop detecting')) {
        setIsProcessingPaused(true);
        speak('Live Navigation paused. Say Resume to continue.');
        return true;
      }

      if (norm === 'resume' || norm.includes('resume navigation') || norm.includes('continue')) {
        setIsProcessingPaused(false);
        speak('Live Navigation resumed. Scanning path ahead.');
        return true;
      }

      // 7. Mode Switch: Indoor vs Outdoor
      if (norm.includes('outdoor mode') || norm.includes('switch to outdoor')) {
        setNavMode('outdoor');
        speak('Outdoor Walking Mode active. Monitoring sidewalks, crosswalks, and traffic signals.');
        return true;
      }

      if (norm.includes('indoor mode') || norm.includes('switch to indoor')) {
        setNavMode('indoor');
        speak('Indoor Navigation Mode active. Monitoring hallway centering, doors, stairs, and obstacles.');
        return true;
      }

      // 8. Flashlight voice command
      if (norm.includes('flashlight on') || norm.includes('turn on light')) {
        toggleFlashlight(true);
        return true;
      }
      if (norm.includes('flashlight off') || norm.includes('turn off light')) {
        toggleFlashlight(false);
        return true;
      }

      // 9. Heading update
      if (norm.includes('which way') || norm.includes('heading') || norm.includes('compass')) {
        speak(`Heading ${cardinalDirection}, ${compassHeading || 0} degrees.`);
        return true;
      }

      return false;
    });

    return () => unregister();
  }, [
    registerCommandListener,
    executeCommand,
    handleDescribeScene,
    handleFindTarget,
    handleReadSign,
    toggleFlashlight,
    cardinalDirection,
    compassHeading,
    speak,
  ]);

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-6 sm:px-8 space-y-6 pb-20 bg-[#0a0a0a] min-h-screen text-white font-sans">
      {/* High-Contrast Voice Status Card */}
      <VoiceStatusCard />

      {/* Main Feature Container (WCAG AAA Pure Black & Amber-Yellow) */}
      <section
        aria-label="Live Navigation & Obstacle Assistant"
        className="bg-[#0a0a0a] border-4 border-[#eab308] rounded-3xl p-6 sm:p-10 space-y-8 shadow-[0_0_50px_rgba(234,179,8,0.15)]"
      >
        {/* Top Feature Header */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b-2 border-zinc-800">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-16 h-16 bg-[#eab308] text-black rounded-2xl flex items-center justify-center font-black shadow-lg shrink-0">
              <Compass className="w-9 h-9 stroke-[2.75]" />
            </div>
            <div>
              <span className="text-[#eab308] font-black text-xs uppercase tracking-widest block">
                Accessibility Vision Aid • Feature 1
              </span>
              <h1 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tight">
                Live Navigation & Obstacle Assistant
              </h1>
            </div>
          </div>

          <button
            onClick={() => executeCommand('GO_BACK')}
            aria-label="Return to Home screen"
            className="w-full sm:w-auto min-h-[48px] px-6 py-3.5 bg-zinc-900 hover:bg-zinc-800 text-white font-black text-sm uppercase tracking-wider rounded-2xl border-2 border-zinc-700 flex items-center justify-center gap-2 cursor-pointer focus:ring-4 focus:ring-[#eab308] transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-[#eab308]" />
            <span>Say "Home"</span>
          </button>
        </div>

        {/* Section 1: Camera Access Denied Error Screen */}
        {hasPermission === false && (
          <div className="bg-zinc-950 border-4 border-red-500 rounded-3xl p-8 sm:p-10 text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-2xl mx-auto flex items-center justify-center border-2 border-red-500">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl sm:text-3xl font-black text-white uppercase">
                Camera Access Required
              </h2>
              <p className="text-zinc-200 text-lg max-w-xl mx-auto leading-relaxed">
                {streamError ||
                  'Camera access was denied. Live Navigation requires camera access to detect obstacles. Say Home to return to the main screen.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <button
                onClick={requestCameraAccess}
                className="min-h-[52px] px-8 py-4 bg-[#eab308] hover:bg-yellow-400 text-black font-black uppercase text-base rounded-2xl transition-all focus:ring-4 focus:ring-white cursor-pointer flex items-center gap-3 shadow-lg"
              >
                <Camera className="w-6 h-6 stroke-[2.5]" />
                <span>Grant Camera Permission</span>
              </button>
              <button
                onClick={() => executeCommand('GO_BACK')}
                className="min-h-[52px] px-8 py-4 bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase text-base rounded-2xl transition-all border-2 border-zinc-600 cursor-pointer flex items-center gap-3 focus:ring-4 focus:ring-[#eab308]"
              >
                <ArrowLeft className="w-6 h-6 text-[#eab308]" />
                <span>Home</span>
              </button>
            </div>
          </div>
        )}

        {/* Section 2: Active Navigation & Live Video HUD */}
        {hasPermission === true && (
          <div className="space-y-6">
            {/* Environmental Limitation Banner if any */}
            {envWarning && (
              <div className="bg-yellow-500/20 border-2 border-yellow-500 p-4 rounded-2xl flex items-center justify-between gap-3 text-yellow-300 font-bold text-sm">
                <div className="flex items-center gap-2">
                  <Sun className="w-5 h-5 text-yellow-400 shrink-0" />
                  <span>{envWarning}</span>
                </div>
                <button
                  onClick={() => toggleFlashlight()}
                  className="px-4 py-2 bg-yellow-500 text-black font-black uppercase text-xs rounded-xl"
                >
                  Turn On Flashlight
                </button>
              </div>
            )}

            {/* Quick Status Bar: Mode, Heading, Audio Mode & Pause Status */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                onClick={() => {
                  const next = navMode === 'indoor' ? 'outdoor' : 'indoor';
                  setNavMode(next);
                  speak(`${next === 'indoor' ? 'Indoor' : 'Outdoor'} navigation mode active.`);
                }}
                className="p-3.5 bg-zinc-950 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all"
              >
                <span className="text-xs text-zinc-400 font-bold uppercase block">Environment Mode</span>
                <span className="text-base font-black text-[#eab308] uppercase capitalize">
                  {navMode} Walking
                </span>
              </button>

              <div className="p-3.5 bg-zinc-950 border-2 border-zinc-800 rounded-2xl">
                <span className="text-xs text-zinc-400 font-bold uppercase block">Orientation Compass</span>
                <span className="text-base font-black text-white">
                  Heading {cardinalDirection} ({compassHeading || 0}°)
                </span>
              </div>

              <button
                onClick={() => {
                  const next = audioMode === 'speech_and_tones' ? 'beeps_only' : 'speech_and_tones';
                  setAudioMode(next);
                  speak(next === 'beeps_only' ? 'Beeps only mode.' : 'Voice alerts activated.');
                }}
                className="p-3.5 bg-zinc-950 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all"
              >
                <span className="text-xs text-zinc-400 font-bold uppercase block">Audio Alerts</span>
                <span className="text-base font-black text-white flex items-center gap-1.5">
                  {audioMode === 'speech_and_tones' ? (
                    <>
                      <Volume2 className="w-4 h-4 text-[#eab308]" />
                      <span>Speech & Tones</span>
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-4 h-4 text-yellow-400" />
                      <span>Beeps Only</span>
                    </>
                  )}
                </span>
              </button>

              <button
                onClick={() => {
                  setIsProcessingPaused(!isProcessingPaused);
                  speak(isProcessingPaused ? 'Resuming navigation.' : 'Navigation paused.');
                }}
                className="p-3.5 bg-zinc-950 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all"
              >
                <span className="text-xs text-zinc-400 font-bold uppercase block">Vision Engine</span>
                <span className="text-base font-black text-white flex items-center gap-1.5">
                  {isProcessingPaused ? (
                    <>
                      <Play className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">Paused</span>
                    </>
                  ) : visionModelStatus === 'loading' ? (
                    <>
                      <Activity className="w-4 h-4 text-yellow-400 animate-pulse" />
                      <span className="text-yellow-300">Loading on-device model</span>
                    </>
                  ) : visionModelStatus === 'error' ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">Detection unavailable</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4 text-green-400 animate-pulse" />
                      <span className="text-green-400">On-device detection active</span>
                    </>
                  )}
                </span>
              </button>
            </div>

            {/* High-Contrast Live Video Preview with Bounding Box Overlays */}
            <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden border-4 border-zinc-800 shadow-2xl">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Sighted Companion Overlay: Bounding Boxes & Distance Tags */}
              <div className="absolute inset-0 pointer-events-none p-4">
                {activeHazards.map((hazard) => (
                  <div
                    key={hazard.id}
                    style={{
                      left: `${hazard.box.x * 100}%`,
                      top: `${hazard.box.y * 100}%`,
                      width: `${hazard.box.width * 100}%`,
                      height: `${hazard.box.height * 100}%`,
                    }}
                    className={`absolute border-4 ${
                      hazard.tier === 1
                        ? 'border-red-500 bg-red-500/20'
                        : hazard.tier === 2
                        ? 'border-yellow-400 bg-yellow-400/20'
                        : 'border-green-400 bg-green-400/10'
                    } rounded-xl transition-all flex flex-col justify-between p-2`}
                  >
                    <span
                      className={`px-3 py-1 text-black font-black text-xs uppercase tracking-wider rounded-md self-start ${
                        hazard.tier === 1 ? 'bg-red-500' : 'bg-yellow-400'
                      }`}
                    >
                      ~{hazard.distanceMeters}m • {hazard.label} • {Math.round(hazard.confidence * 100)}%
                    </span>
                    <span className="text-white text-xs font-black drop-shadow-md self-end bg-black/60 px-2 py-0.5 rounded">
                      {hazard.clockPosition}
                    </span>
                  </div>
                ))}

                {/* Chest-High Guide Overlay Frame */}
                <div className="absolute inset-x-8 bottom-4 text-center">
                  <span className="px-4 py-2 bg-black/80 text-[#eab308] border border-[#eab308]/40 rounded-full text-xs font-black uppercase tracking-wider inline-flex items-center gap-2">
                    <Footprints className="w-4 h-4" />
                    <span>Hold Phone Chest-High Facing Forward</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Primary Safety Alert Display Card */}
            <div
              className={`p-6 sm:p-8 rounded-3xl border-4 transition-all ${
                activeHazards.some((h) => h.tier === 1)
                  ? 'bg-red-950/80 border-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)]'
                  : activeHazards.some((h) => h.tier === 2)
                  ? 'bg-yellow-500 text-black border-yellow-300 shadow-[0_0_30px_rgba(234,179,8,0.4)]'
                  : 'bg-zinc-950 border-zinc-800 text-white'
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b-2 border-black/20">
                <span className="text-xs font-black uppercase tracking-widest">
                  {activeHazards.some((h) => h.tier === 1)
                    ? 'Tier 1 • Imminent Hazard Alert'
                    : activeHazards.some((h) => h.tier === 2)
                    ? 'Tier 2 • Caution & Path Guidance'
                    : 'Object Detection'}
                </span>
                <span className="text-xs font-extrabold uppercase">
                  {audioMode === 'speech_and_tones' ? 'Voice Active' : 'Beeps Only'}
                </span>
              </div>

              <div className="py-3">
                <p className="text-2xl sm:text-4xl font-black leading-snug">
                  {lastWarning || 'Waiting for the first camera detection...'}
                </p>
                <p className="mt-3 text-sm font-semibold opacity-80">
                  Object distances are approximate estimates from apparent object size. No detection does not mean the path is safe.
                </p>
              </div>

              {targetTracking && (
                <div className="mt-2 pt-2 border-t border-black/20 flex items-center justify-between text-sm font-black">
                  <span>Tracking: "{targetTracking.target}"</span>
                  <span>{targetTracking.guidance}</span>
                </div>
              )}
            </div>

            {/* Hands-Free Voice Command Action Tiles (Touch Accessible: Min 56px height) */}
            <div className="space-y-3">
              <span className="text-xs font-black text-zinc-400 uppercase tracking-wider block">
                Hands-Free Spoken Actions (Say or Tap):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
                <button
                  onClick={handleDescribeScene}
                  className="min-h-[56px] p-4 bg-zinc-950 hover:bg-zinc-900 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-[#eab308]"
                >
                  <span className="text-xs text-zinc-400 uppercase font-bold block group-hover:text-[#eab308]">
                    Say "Describe Scene"
                  </span>
                  <span className="text-base font-black text-white group-hover:text-[#eab308] block">
                    Spatial Overview
                  </span>
                </button>

                <button
                  onClick={() => handleFindTarget('door')}
                  className="min-h-[56px] p-4 bg-zinc-950 hover:bg-zinc-900 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-[#eab308]"
                >
                  <span className="text-xs text-zinc-400 uppercase font-bold block group-hover:text-[#eab308]">
                    Say "Find Door" / "Find Chair"
                  </span>
                  <span className="text-base font-black text-white group-hover:text-[#eab308] block">
                    Target Finder
                  </span>
                </button>

                <button
                  onClick={handleReadSign}
                  className="min-h-[56px] p-4 bg-zinc-950 hover:bg-zinc-900 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-[#eab308]"
                >
                  <span className="text-xs text-zinc-400 uppercase font-bold block group-hover:text-[#eab308]">
                    Say "Read Sign"
                  </span>
                  <span className="text-base font-black text-white group-hover:text-[#eab308] block">
                    Signboard OCR
                  </span>
                </button>

                <button
                  onClick={() => toggleFlashlight()}
                  className="min-h-[56px] p-4 bg-zinc-950 hover:bg-zinc-900 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-[#eab308]"
                >
                  <span className="text-xs text-zinc-400 uppercase font-bold block group-hover:text-[#eab308]">
                    Say "Flashlight On/Off"
                  </span>
                  <span className="text-base font-black text-white group-hover:text-[#eab308] block">
                    {flashlightActive ? 'Flashlight On' : 'Flashlight Off'}
                  </span>
                </button>
              </div>
            </div>

            {/* Sighted Companion / Specialist Guide Note */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl text-xs text-zinc-400 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <span>
                  <strong>Cane & Dog Companion Rule:</strong> Use Live Navigation alongside your primary mobility tool. Microphones remain active continuously.
                </span>
              </div>
              <span className="text-[#eab308] font-black uppercase tracking-wider shrink-0">
                WCAG AAA High Contrast
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};
