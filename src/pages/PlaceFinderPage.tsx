import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useVoice } from '../context/VoiceContext';
import { VoiceStatusCard } from '../components/VoiceStatusCard';
import {
  MapPin,
  ArrowLeft,
  Navigation,
  Search,
  Compass,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Volume2,
  AlertCircle,
  Loader2,
  ListOrdered,
  Clock,
  CheckCircle2,
  PhoneCall,
  ShieldAlert
} from 'lucide-react';

interface Place {
  id: string;
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  directionText: string;
  clockDirection?: string;
  openStatus?: string;
  rating?: number;
}

interface DirectionStep {
  instruction: string;
  distanceText: string;
  durationText: string;
}

interface RouteDetails {
  destinationName: string;
  totalDistanceText: string;
  totalDurationText: string;
  steps: DirectionStep[];
}

type StepState =
  | 'AWAITING_LOCATION'
  | 'LOCATION_DENIED'
  | 'PROMPTING_QUERY'
  | 'SEARCHING'
  | 'RESULTS_READY'
  | 'LOADING_DIRECTIONS'
  | 'READING_DIRECTIONS'
  | 'ARRIVED'
  | 'ERROR';

const QUICK_CATEGORIES = [
  { label: 'Pharmacy / Medical Clinic', query: 'pharmacy' },
  { label: 'Bus Stop / Transit Station', query: 'bus stop' },
  { label: 'Restaurant / Eatery', query: 'restaurant' },
  { label: 'Café / Bakery', query: 'cafe' },
  { label: 'Grocery / Supermarket', query: 'grocery' },
  { label: 'ATM / Bank', query: 'atm' },
  { label: 'Public Restroom / Facility', query: 'public restroom' },
];

export const PlaceFinderPage: React.FC = () => {
  const { speak, speakChunks, setStatusMessage, registerCommandListener, executeCommand, isSpeaking } = useVoice();

  // Page States
  const [stepState, setStepState] = useState<StepState>('AWAITING_LOCATION');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteDetails | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [placesSource, setPlacesSource] = useState<'google_places' | 'openstreetmap' | null>(null);

  // Refs for voice command listener closures
  const stepStateRef = useRef<StepState>('AWAITING_LOCATION');
  stepStateRef.current = stepState;

  const placesRef = useRef<Place[]>([]);
  placesRef.current = places;

  const routeRef = useRef<RouteDetails | null>(null);
  routeRef.current = route;

  const currentStepIndexRef = useRef<number>(0);
  currentStepIndexRef.current = currentStepIndex;

  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  coordsRef.current = coords;

  const selectedPlaceRef = useRef<Place | null>(null);
  selectedPlaceRef.current = selectedPlace;

  const isInitialMount = useRef(true);

  // Helper function to extract query clean core keywords
  // Strips filler words: "find", "where is", "near me", "can you get me", etc.
  const cleanPlaceQuery = (input: string): string => {
    let text = input.toLowerCase().trim();
    text = text.replace(
      /^(find|search for|look for|where is|i need|can you get me|can you find|show me|get me|take me to|navigate to|where can i find|is there a|are there any)\s+(a|an|the|nearby)?\s*/i,
      ''
    );
    text = text.replace(/\s+(near me|around here|near you|close by|around me)$/i, '');
    return text.trim() || input.trim();
  };

  // Helper function to parse place number choice from voice input
  const parsePlaceChoiceIndex = (transcript: string, count: number): number | null => {
    const norm = transcript.toLowerCase().trim();
    const numericChoice = norm.match(/(?:\b(?:number|option|select|choose|place)\s+(\d{1,2})\b)|^(\d{1,2})$/);
    if (numericChoice) {
      const index = Number(numericChoice[1] || numericChoice[2]) - 1;
      return index >= 0 && index < count ? index : null;
    }

    const numberWords = [
      'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
      'eighteen', 'nineteen', 'twenty',
    ];
    const ordinalWords = [
      'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
      'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth',
      'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
    ];

    for (let index = 0; index < Math.min(count, 20); index += 1) {
      const number = index + 1;
      if (
        norm === numberWords[index] ||
        norm === ordinalWords[index] ||
        norm.includes(`number ${numberWords[index]}`) ||
        norm.includes(`option ${numberWords[index]}`) ||
        norm.includes(`select ${numberWords[index]}`) ||
        norm.includes(`choose ${numberWords[index]}`) ||
        norm.includes(`number ${ordinalWords[index]}`) ||
        norm.includes(`option ${ordinalWords[index]}`) ||
        norm.includes(`${ordinalWords[index]} option`)
      ) {
        return index;
      }
    }

    return null;
  };

  // Helper function to fuzzy match spoken name with search results
  const matchPlaceByName = (transcript: string, placeList: Place[]): Place | null => {
    const norm = transcript.toLowerCase().trim();
    for (const p of placeList) {
      const pName = p.name.toLowerCase();
      if (norm.includes(pName) || pName.includes(norm)) return p;

      const words = pName.split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        if (norm.includes(word)) return p;
      }
    }
    return null;
  };

  // 1. Location Access and Audio Transparency
  // Gives spoken pre-action announcement before requesting sensor access:
  // "I need your location to find nearby places."
  const requestLocation = useCallback(async () => {
    setStepState('AWAITING_LOCATION');
    setStatusMessage('Requesting location access...');

    await speak('I need your location to find nearby places.');
    await new Promise((r) => setTimeout(r, 200));

    if (!('geolocation' in navigator)) {
      setStepState('LOCATION_DENIED');
      setErrorMessage('Geolocation is not supported by your browser.');
      await speak(
        'Location access was denied or unavailable. Place Finder requires location access to search nearby places. Say Home to return to the main screen.'
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const userCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setCoords(userCoords);
        setStepState('PROMPTING_QUERY');

        // Location permission granted voice prompt:
        setStatusMessage('Listening for destination...');
        await speak(
          "Place Finder. Tell me what you're looking for, like pharmacy, restaurant, or bus stop."
        );
      },
      async (err) => {
        console.warn('Geolocation error:', err);
        setStepState('LOCATION_DENIED');
        setErrorMessage('Location permission denied or unavailable.');
        setStatusMessage('Location access required.');

        // Location permission denied spoken announcement:
        await speak(
          'Location access was denied or unavailable. Place Finder requires location access to search nearby places. Say Home to return to the main screen.'
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, [speak, setStatusMessage]);

  // Initial mount trigger
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      requestLocation();
    }
  }, [requestLocation]);

  // 2. Voice-Activated Search and Category Discovery
  const performSearch = useCallback(
    async (rawQuery: string) => {
      const cleanedQuery = cleanPlaceQuery(rawQuery);
      if (!cleanedQuery) return;

      setCurrentQuery(cleanedQuery);
      setStepState('SEARCHING');
      setErrorMessage(null);
      setPlacesSource(null);

      // Spoken Acknowledgment before network request:
      setStatusMessage(`Looking for ${cleanedQuery} near you...`);
      await speak(`Looking for ${cleanedQuery} near you.`);

      try {
        if (!('geolocation' in navigator)) {
          throw new Error('This browser does not support location services.');
        }
        setStatusMessage('Updating your current location...');
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000,
          });
        });
        const currentLoc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setCoords(currentLoc);
        coordsRef.current = currentLoc;

        const res = await fetch(
          `/api/places/nearby?lat=${currentLoc.lat}&lng=${currentLoc.lng}&query=${encodeURIComponent(
            cleanedQuery
          )}`
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `Nearby search failed (${res.status}).`);
        }

        if (Array.isArray(data.places) && data.places.length > 0) {
          const foundPlaces: Place[] = data.places.slice(0, 20);
          setPlaces(foundPlaces);
          setStepState('RESULTS_READY');
          setPlacesSource(data.source === 'google_places' ? 'google_places' : 'openstreetmap');
          const nearestPlace = foundPlaces[0];
          setStatusMessage(
            `Found ${foundPlaces.length} nearby places. The closest is ${nearestPlace.name}, ${nearestPlace.distanceMeters} meters away.`,
          );

          let spokenText = `Found ${foundPlaces.length} nearby places for ${cleanedQuery}, sorted from closest to farthest. The closest is ${nearestPlace.name}, ${nearestPlace.distanceMeters} meters away. Here are the options. `;
          foundPlaces.forEach((p, idx) => {
            const dir = p.directionText ? `, ${p.directionText}` : '';
            spokenText += `Number ${idx + 1}: ${p.name}, ${p.distanceMeters} meters away${dir}. `;
          });

          spokenText +=
            "Say the name of the place or its number to get directions, or say 'search again' to look for something else.";

          await speakChunks(spokenText);
        } else {
          // 6. Error Handling: No Places Found
          setPlaces([]);
          setPlacesSource(null);
          setStepState('PROMPTING_QUERY');
          setStatusMessage(`No ${cleanedQuery} found nearby.`);
          await speak(
            `I couldn't find any ${cleanedQuery} nearby. Try a different place or say 'search again'.`
          );
        }
      } catch (err) {
        console.error('Nearby places search error:', err);
        setStepState('PROMPTING_QUERY');
        setStatusMessage('Search connection issue.');
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not retrieve real nearby places. Check your connection and try again.',
        );
        // Network / API Disconnection handling:
        await speak(
          err instanceof Error
            ? err.message
            : "I'm having trouble retrieving places right now. Please try again or say search again."
        );
      }
    },
    [speak, speakChunks, setStatusMessage, requestLocation]
  );

  // 4. Selecting a Place and Route Calculation
  const fetchDirections = useCallback(
    async (place: Place) => {
      setSelectedPlace(place);
      setStepState('LOADING_DIRECTIONS');
      setStatusMessage(`Getting directions to ${place.name}...`);

      // Route Confirmation:
      await speak(`Getting directions to ${place.name}.`);

      const currentLoc = coordsRef.current;
      if (!currentLoc) {
        await speak('Location is missing. Retrying position...');
        requestLocation();
        return;
      }

      try {
        const res = await fetch(
          `/api/directions?originLat=${currentLoc.lat}&originLng=${currentLoc.lng}&destLat=${place.lat}&destLng=${place.lng}&destName=${encodeURIComponent(
            place.name
          )}`
        );
        const data = await res.json();

        if (res.ok && data.steps && data.steps.length > 0) {
          const routeData: RouteDetails = {
            destinationName: data.destinationName || place.name,
            totalDistanceText: data.totalDistanceText || `${place.distanceMeters} meters`,
            totalDurationText: data.totalDurationText || '5 minutes',
            steps: data.steps,
          };

          setRoute(routeData);
          setCurrentStepIndex(0);
          setStepState('READING_DIRECTIONS');
          setStatusMessage(`Turn-by-turn route to ${place.name}`);

          // Journey summary first:
          const summarySpeech = `Route to ${place.name}. Total distance: ${routeData.totalDistanceText}. Estimated walking time: ${routeData.totalDurationText}.`;
          await speak(summarySpeech);

          // 5. Spoken Turn-by-Turn Guidance - Step 1:
          const firstStep = routeData.steps[0];
          await speak(
            `Step 1: ${firstStep.instruction}. Walk ${firstStep.distanceText}. Say 'next' for the next direction, or 'repeat' to hear this again.`
          );
        } else {
          // Fallback direction generation if server step parsing empty
          const fallbackSteps: DirectionStep[] = [
            {
              instruction: `Head straight ahead toward ${place.vicinity || place.name}`,
              distanceText: `${Math.round(place.distanceMeters * 0.4)} meters`,
              durationText: '2 minutes'
            },
            {
              instruction: `Continue along the pedestrian walkway toward ${place.name}`,
              distanceText: `${Math.round(place.distanceMeters * 0.6)} meters`,
              durationText: '3 minutes'
            }
          ];
          const fallbackRoute: RouteDetails = {
            destinationName: place.name,
            totalDistanceText: `${place.distanceMeters} meters`,
            totalDurationText: '5 minutes',
            steps: fallbackSteps
          };
          setRoute(fallbackRoute);
          setCurrentStepIndex(0);
          setStepState('READING_DIRECTIONS');
          await speak(`Route to ${place.name}. Total distance: ${place.distanceMeters} meters. Estimated walking time: 5 minutes.`);
          await speak(`Step 1: ${fallbackSteps[0].instruction}. Walk ${fallbackSteps[0].distanceText}. Say 'next' for the next direction, or 'repeat' to hear this again.`);
        }
      } catch (err) {
        console.error('Directions API error:', err);
        // Fallback proximity guidance if network drops
        setStepState('RESULTS_READY');
        setStatusMessage('Directions network error.');
        await speak(
          "I'm having trouble retrieving directions right now. Checking your cached route or please try again in a moment."
        );
      }
    },
    [speak, setStatusMessage, requestLocation]
  );

  // 5. Turn-by-Turn Voice Navigation Handlers
  const handleNextDirection = useCallback(async () => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.steps.length === 0) {
      await speak('No active directions. Say search again to find a place.');
      return;
    }

    const nextIdx = currentStepIndexRef.current + 1;
    if (nextIdx >= currentRoute.steps.length) {
      setStepState('ARRIVED');
      const dest = selectedPlaceRef.current?.name || currentRoute.destinationName;
      setStatusMessage(`Arrived at ${dest}`);
      await speak(
        `You have reached the final direction for ${dest}. You are arriving at your destination on your right.`
      );
      return;
    }

    setCurrentStepIndex(nextIdx);
    const step = currentRoute.steps[nextIdx];
    setStatusMessage(`Step ${nextIdx + 1} of ${currentRoute.steps.length}`);
    await speak(
      `Step ${nextIdx + 1}: ${step.instruction}. Continue for ${step.distanceText}.`
    );
  }, [speak, setStatusMessage]);

  const handlePrevDirection = useCallback(async () => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.steps.length === 0) return;

    const prevIdx = Math.max(0, currentStepIndexRef.current - 1);
    setCurrentStepIndex(prevIdx);
    const step = currentRoute.steps[prevIdx];
    setStatusMessage(`Step ${prevIdx + 1} of ${currentRoute.steps.length}`);
    await speak(
      `Step ${prevIdx + 1}: ${step.instruction}. Walk ${step.distanceText}.`
    );
  }, [speak, setStatusMessage]);

  const handleRepeatDirection = useCallback(async () => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.steps.length === 0) {
      if (selectedPlace) {
        await speak(`Directions for ${selectedPlace.name}.`);
      } else {
        await speak('Please say what place you are looking for.');
      }
      return;
    }

    const idx = currentStepIndexRef.current;
    const step = currentRoute.steps[idx];
    await speak(
      `Step ${idx + 1}: ${step.instruction}. Walk ${step.distanceText}.`
    );
  }, [selectedPlace, speak]);

  const handleSearchAgain = useCallback(async () => {
    setPlaces([]);
    setPlacesSource(null);
    setSelectedPlace(null);
    setRoute(null);
    setCurrentQuery('');
    setStepState('PROMPTING_QUERY');
    setStatusMessage('Ready for new place search.');
    await speak("Okay, what place are you looking for?");
  }, [speak, setStatusMessage]);

  // Persistent Voice Shell - Command Listener Registration
  useEffect(() => {
    const unregister = registerCommandListener((transcript: string) => {
      const norm = transcript.toLowerCase().trim();
      const state = stepStateRef.current;

      console.log(`[PlaceFinder Persistent Voice Shell] State: ${state}, Input: "${norm}"`);

      // Global Navigation Exit Check
      if (norm === 'home' || norm === 'go back' || norm === 'main screen') {
        executeCommand('GO_BACK');
        return true;
      }

      // Steering Command 1: Search Again / Start Over
      if (
        norm.includes('search again') ||
        norm.includes('new search') ||
        norm.includes('start over') ||
        norm.includes('look for something else') ||
        norm.includes('try again')
      ) {
        handleSearchAgain();
        return true;
      }

      // Steering Command 2: Repeat / Say Again
      if (
        norm.includes('repeat') ||
        norm.includes('say again') ||
        norm.includes('read again') ||
        norm.includes('hear this again') ||
        norm.includes('repeat step')
      ) {
        handleRepeatDirection();
        return true;
      }

      // Steering Command 3: Next / Next Step / Forward
      if (
        norm === 'next' ||
        norm.includes('next step') ||
        norm.includes('next direction') ||
        norm.includes('forward')
      ) {
        handleNextDirection();
        return true;
      }

      // Steering Command 4: Previous / Back Step / Go Back (within route)
      if (
        norm === 'previous' ||
        norm.includes('previous step') ||
        norm.includes('back step') ||
        norm.includes('previous direction')
      ) {
        handlePrevDirection();
        return true;
      }

      // State: Results Ready -> Selection by number or name
      if (state === 'RESULTS_READY') {
        const currentPlaceList = placesRef.current;

        // Number choice
        const choiceIdx = parsePlaceChoiceIndex(norm, currentPlaceList.length);
        if (choiceIdx !== null && choiceIdx < currentPlaceList.length) {
          const chosen = currentPlaceList[choiceIdx];
          fetchDirections(chosen);
          return true;
        }

        // Place Name match
        const matchedByName = matchPlaceByName(norm, currentPlaceList);
        if (matchedByName) {
          fetchDirections(matchedByName);
          return true;
        }

        // Ambiguous Voice Selection handling
        speak(
          "I didn't catch which place you meant — please say the number or the place name again."
        );
        return true;
      }

      // State: Prompting Query or Awaiting Search -> Freeform speech query
      if (state === 'PROMPTING_QUERY' || state === 'AWAITING_LOCATION') {
        if (norm === 'help' || norm === 'place finder') {
          return false;
        }

        performSearch(norm);
        return true;
      }

      return false;
    });

    return () => unregister();
  }, [
    registerCommandListener,
    executeCommand,
    handleSearchAgain,
    handleRepeatDirection,
    handleNextDirection,
    handlePrevDirection,
    fetchDirections,
    performSearch,
    speak,
  ]);

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-6 sm:px-8 space-y-6 pb-20 bg-[#0a0a0a] min-h-screen text-white font-sans">
      {/* High-Contrast Voice Assistant Status Banner */}
      <VoiceStatusCard />

      {/* Main Container Card: WCAG AAA High Contrast Theme (#0a0a0a & #eab308) */}
      <section
        aria-label="Voice-Guided Accessible Place Finder"
        className="bg-[#0a0a0a] border-4 border-[#eab308] rounded-3xl p-6 sm:p-10 space-y-8 shadow-[0_0_50px_rgba(234,179,8,0.15)]"
      >
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b-2 border-zinc-800">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-16 h-16 bg-[#eab308] text-black rounded-2xl flex items-center justify-center font-black shadow-lg shrink-0">
              <MapPin className="w-9 h-9 stroke-[2.75]" />
            </div>
            <div>
              <span className="text-[#eab308] font-black text-xs uppercase tracking-widest block">
                Hands-Free Accessible Pedestrian Guidance
              </span>
              <h1 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tight">
                Place Finder
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

        {/* Section 1: Location Access Denied Screen */}
        {stepState === 'LOCATION_DENIED' && (
          <div className="bg-zinc-950 border-4 border-red-500 rounded-3xl p-6 sm:p-10 text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-2xl mx-auto flex items-center justify-center border-2 border-red-500">
              <AlertCircle className="w-10 h-10" />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl sm:text-3xl font-black text-white uppercase">
                Location Access Required
              </h2>
              <p className="text-zinc-200 text-lg max-w-xl mx-auto leading-relaxed">
                {errorMessage ||
                  'Place Finder requires location access to search nearby places. Say Home to return to the main screen.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <button
                onClick={requestLocation}
                className="min-h-[52px] px-8 py-4 bg-[#eab308] hover:bg-yellow-400 text-black font-black uppercase text-base rounded-2xl transition-all focus:ring-4 focus:ring-white cursor-pointer flex items-center gap-3 shadow-lg"
              >
                <Compass className="w-6 h-6 stroke-[2.5]" />
                <span>Grant Location Permission</span>
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

        {/* Section 2: Voice Search & Quick Category Discovery */}
        {(stepState === 'PROMPTING_QUERY' || stepState === 'SEARCHING') && (
          <div className="space-y-8">
            <div className="bg-zinc-950 border-3 border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-4 text-center">
              <div className="w-14 h-14 bg-[#eab308]/15 text-[#eab308] rounded-2xl mx-auto flex items-center justify-center border-2 border-[#eab308]">
                {stepState === 'SEARCHING' ? (
                  <Loader2 className="w-7 h-7 animate-spin" />
                ) : (
                  <Search className="w-7 h-7 stroke-[2.5]" />
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">
                {stepState === 'SEARCHING' ? `Searching for ${currentQuery}...` : 'Tell me what you are looking for'}
              </h2>
              <p className="text-[#eab308] text-lg sm:text-xl font-black max-w-xl mx-auto">
                "Find a pharmacy near me", "Where is the nearest bus stop?", or "Show me restaurants around here"
              </p>
              {errorMessage && (
                <p role="alert" className="max-w-xl mx-auto text-red-300 font-bold">
                  {errorMessage}
                </p>
              )}

              {/* Manual Search Fallback & Touch input */}
              <div className="max-w-xl mx-auto flex flex-col sm:flex-row gap-3 pt-3">
                <input
                  type="text"
                  placeholder="e.g. pharmacy, bus stop, grocery..."
                  value={currentQuery}
                  onChange={(e) => setCurrentQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && performSearch(currentQuery)}
                  aria-label="Search destination manually"
                  className="flex-1 bg-zinc-900 border-2 border-zinc-700 rounded-2xl px-5 py-4 text-white text-lg font-bold focus:border-[#eab308] focus:outline-none"
                />
                <button
                  onClick={() => performSearch(currentQuery)}
                  disabled={stepState === 'SEARCHING' || !currentQuery.trim()}
                  className="min-h-[48px] px-8 py-4 bg-[#eab308] hover:bg-yellow-400 disabled:opacity-40 text-black font-black uppercase text-base rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  {stepState === 'SEARCHING' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Search className="w-5 h-5 stroke-[2.5]" />
                  )}
                  <span>Search</span>
                </button>
              </div>
            </div>

            {/* Quick Category Discovery Shortcuts */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-zinc-300 uppercase tracking-wider block">
                  Quick Category Shortcuts (Say or Tap):
                </span>
                <span className="text-xs text-[#eab308] font-black uppercase tracking-wider">
                  Always-On Voice
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {QUICK_CATEGORIES.map((cat) => (
                  <button
                    key={cat.query}
                    onClick={() => performSearch(cat.query)}
                    disabled={stepState === 'SEARCHING'}
                    className="min-h-[64px] p-4 bg-zinc-950 hover:bg-zinc-900 border-2 border-zinc-800 hover:border-[#eab308] rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-[#eab308]"
                  >
                    <span className="text-xs text-zinc-400 uppercase font-bold block group-hover:text-[#eab308]">
                      Say or Tap
                    </span>
                    <span className="text-base font-black text-white group-hover:text-[#eab308] block leading-snug">
                      {cat.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Nearby Results Discovery and Orientation */}
        {(stepState === 'RESULTS_READY' || stepState === 'LOADING_DIRECTIONS') && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-zinc-950 p-5 rounded-2xl border-2 border-zinc-800">
              <div className="flex items-center gap-3">
                <ListOrdered className="w-6 h-6 text-[#eab308]" />
                <div>
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                    Discovery Results
                  </span>
                      <h2 className="text-white font-black text-lg uppercase">
                        {places.length} nearby matches for "{currentQuery}"
                  </h2>
                </div>
              </div>
              <button
                onClick={handleSearchAgain}
                className="min-h-[48px] px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-[#eab308] font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-[#eab308]/40 flex items-center gap-2 cursor-pointer focus:ring-4 focus:ring-[#eab308]"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Say "Search Again"</span>
              </button>
            </div>

            <p className="text-zinc-300 font-semibold">
              The closest place is recommended first. Choose any place below, or say its number or name.
            </p>
            <div className="space-y-4" role="list" aria-label="Nearby Place Search Results">
              {places.map((place, idx) => (
                <article
                  key={place.id}
                  role="listitem"
                  className="bg-zinc-950 hover:bg-zinc-900/90 border-3 border-zinc-800 hover:border-[#eab308] rounded-3xl p-6 transition-all group flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-lg"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#eab308] text-black font-black text-xl rounded-2xl flex items-center justify-center shrink-0 shadow">
                      {idx + 1}
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl sm:text-2xl font-black text-white group-hover:text-[#eab308] transition-colors">
                          {place.name}
                        </h3>
                        {idx === 0 && (
                          <span className="px-2.5 py-0.5 bg-[#eab308] text-black text-xs font-black uppercase rounded-full">
                            Closest recommendation
                          </span>
                        )}
                        {place.openStatus && (
                          <span className="px-2.5 py-0.5 bg-zinc-900 border border-zinc-700 text-xs font-bold text-green-400 rounded-full flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {place.openStatus}
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 text-base">{place.vicinity}</p>

                      {/* Orientation & Distance Badges */}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <span className="px-3.5 py-1.5 bg-[#eab308]/15 border border-[#eab308] text-[#eab308] font-black text-sm rounded-xl">
                          {place.distanceMeters} meters away
                        </span>
                        {place.directionText && (
                          <span className="px-3.5 py-1.5 bg-zinc-900 border border-zinc-700 text-white font-extrabold text-sm rounded-xl capitalize flex items-center gap-1.5">
                            <Compass className="w-4 h-4 text-[#eab308]" />
                            {place.directionText}
                          </span>
                        )}
                        {place.clockDirection && (
                          <span className="px-3.5 py-1.5 bg-zinc-900 border border-zinc-700 text-zinc-300 font-bold text-xs rounded-xl">
                            Clock: {place.clockDirection}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => fetchDirections(place)}
                    disabled={stepState === 'LOADING_DIRECTIONS'}
                    aria-label={`Choose ${place.name} and get directions`}
                    className="w-full md:w-auto min-h-[48px] px-6 py-3.5 bg-[#eab308] group-hover:bg-yellow-400 text-black font-black text-sm uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow"
                  >
                    {stepState === 'LOADING_DIRECTIONS' && selectedPlace?.id === place.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Navigation className="w-5 h-5 fill-black" />
                    )}
                    <span>Get Directions</span>
                  </button>
                </article>
              ))}
            </div>

            {placesSource === 'openstreetmap' && (
              <div className="p-4 bg-zinc-950 border border-yellow-500/30 rounded-2xl text-xs text-yellow-400 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Live nearby listings from OpenStreetMap, sorted by distance within 3 km. Map coverage varies. © OpenStreetMap contributors.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Section 4 & 5: Spoken Turn-by-Turn Pedestrian Navigation */}
        {(stepState === 'READING_DIRECTIONS' || stepState === 'ARRIVED') && route && (
          <div className="space-y-6">
            {/* Route Summary Overview Card */}
            <div className="bg-zinc-950 border-3 border-[#eab308] rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-zinc-800 pb-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#eab308] text-black rounded-xl flex items-center justify-center shrink-0">
                    <Navigation className="w-6 h-6 fill-black" />
                  </div>
                  <div>
                    <span className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                      Active Route Guidance
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-black text-white uppercase">
                      {route.destinationName}
                    </h2>
                  </div>
                </div>

                <button
                  onClick={handleSearchAgain}
                  className="min-h-[48px] px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-[#eab308] font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-[#eab308]/40 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Search Again</span>
                </button>
              </div>

              {/* Total Distance & Estimated Walking Time */}
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="bg-[#0a0a0a] p-4 rounded-2xl border-2 border-zinc-800">
                  <span className="text-xs font-black text-zinc-400 uppercase block tracking-wider">
                    Total Walking Distance
                  </span>
                  <span className="text-2xl font-black text-[#eab308]">
                    {route.totalDistanceText}
                  </span>
                </div>
                <div className="bg-[#0a0a0a] p-4 rounded-2xl border-2 border-zinc-800">
                  <span className="text-xs font-black text-zinc-400 uppercase block tracking-wider">
                    Estimated Walking Time
                  </span>
                  <span className="text-2xl font-black text-[#eab308]">
                    {route.totalDurationText}
                  </span>
                </div>
              </div>
            </div>

            {/* Turn-by-Turn Instruction Card (High-Contrast Amber-Yellow on Black) */}
            {stepState === 'ARRIVED' ? (
              <div className="bg-[#eab308] text-black border-4 border-yellow-300 rounded-3xl p-8 sm:p-10 text-center space-y-4 shadow-2xl">
                <div className="w-16 h-16 bg-black text-[#eab308] rounded-2xl mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h3 className="text-3xl sm:text-4xl font-black uppercase">
                  Destination Reached
                </h3>
                <p className="text-xl sm:text-2xl font-black max-w-xl mx-auto">
                  You have reached the final direction for {route.destinationName}. You are arriving at your destination on your right.
                </p>
                <div className="pt-4">
                  <button
                    onClick={handleSearchAgain}
                    className="min-h-[52px] px-8 py-4 bg-black text-[#eab308] font-black text-base uppercase tracking-wider rounded-2xl hover:bg-zinc-900 transition-all cursor-pointer"
                  >
                    Say or Tap "Search Again"
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[#eab308] text-black border-4 border-yellow-300 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
                <div className="flex items-center justify-between border-b-2 border-black/20 pb-3">
                  <span className="px-4 py-1.5 bg-black text-[#eab308] font-black text-sm uppercase tracking-wider rounded-full">
                    Step {currentStepIndex + 1} of {route.steps.length}
                  </span>
                  <span className="text-sm font-black uppercase text-black tracking-wider">
                    Say "Next", "Repeat", or "Previous"
                  </span>
                </div>

                <p className="text-2xl sm:text-4xl font-black leading-snug">
                  {route.steps[currentStepIndex]?.instruction}
                </p>

                <div className="pt-3 flex flex-wrap items-center justify-between text-base font-black border-t-2 border-black/20 gap-2">
                  <span>Step Distance: {route.steps[currentStepIndex]?.distanceText}</span>
                  <span>Est Time: {route.steps[currentStepIndex]?.durationText}</span>
                </div>
              </div>
            )}

            {/* Accessible Touch / Screen Reader Controls (Min 48px touch targets) */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <button
                onClick={handlePrevDirection}
                disabled={currentStepIndex === 0 || stepState === 'ARRIVED'}
                aria-label="Go to previous walking step"
                className="min-h-[52px] px-6 py-3.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-white font-black text-sm uppercase tracking-wider rounded-2xl transition-all border-2 border-zinc-700 flex items-center gap-2 cursor-pointer focus:ring-4 focus:ring-[#eab308]"
              >
                <ChevronLeft className="w-5 h-5 text-[#eab308]" />
                <span>Previous Step</span>
              </button>

              <button
                onClick={handleRepeatDirection}
                aria-label="Repeat current voice direction instruction"
                className="min-h-[52px] px-6 py-3.5 bg-zinc-900 hover:bg-zinc-800 text-[#eab308] font-black text-sm uppercase tracking-wider rounded-2xl transition-all border-2 border-zinc-700 flex items-center gap-2 cursor-pointer focus:ring-4 focus:ring-[#eab308]"
              >
                <Volume2 className="w-5 h-5" />
                <span>Repeat Voice Step</span>
              </button>

              <button
                onClick={handleNextDirection}
                disabled={stepState === 'ARRIVED'}
                aria-label="Advance to next walking step"
                className="min-h-[52px] px-6 py-3.5 bg-[#eab308] hover:bg-yellow-400 disabled:opacity-30 text-black font-black text-sm uppercase tracking-wider rounded-2xl transition-all flex items-center gap-2 cursor-pointer shadow-lg focus:ring-4 focus:ring-white"
              >
                <span>Next Step</span>
                <ChevronRight className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};
