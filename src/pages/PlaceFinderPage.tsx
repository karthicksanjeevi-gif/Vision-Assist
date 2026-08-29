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
  ListOrdered
} from 'lucide-react';

interface Place {
  id: string;
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  directionText: string;
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
  | 'ERROR';

export const PlaceFinderPage: React.FC = () => {
  const { speak, speakChunks, setStatusMessage, registerCommandListener, executeCommand } = useVoice();

  // Page States
  const [stepState, setStepState] = useState<StepState>('AWAITING_LOCATION');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteDetails | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs to avoid stale closure issues in voice command listeners
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

  const isInitialMount = useRef(true);

  // Helper function to extract query clean keywords
  const cleanPlaceQuery = (input: string): string => {
    let text = input.toLowerCase().trim();
    text = text.replace(
      /^(find|search for|look for|where is|i need|can you find|show me|get me|take me to|navigate to|where can i find|is there a|are there any)\s+(a|an|the|nearby)?\s*/i,
      ''
    );
    text = text.replace(/\s+(near me|nearby|around here|close by)$/i, '');
    return text.trim() || input.trim();
  };

  // Helper function to parse place number choice from voice input
  const parsePlaceChoiceIndex = (transcript: string, count: number): number | null => {
    const norm = transcript.toLowerCase().trim();

    if (/\b(first|one|1|number 1|number one|option 1)\b/i.test(norm)) return 0;
    if (/\b(second|two|2|number 2|number two|option 2)\b/i.test(norm)) return 1;
    if (/\b(third|three|3|number 3|number three|option 3)\b/i.test(norm)) return 2;
    if (/\b(fourth|four|4|number 4|number four|option 4)\b/i.test(norm)) return 3;
    if (/\b(fifth|five|5|number 5|number five|option 5)\b/i.test(norm)) return 4;

    return null;
  };

  // Helper function to fuzzy match spoken name with search results
  const matchPlaceByName = (transcript: string, placeList: Place[]): Place | null => {
    const norm = transcript.toLowerCase();
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

  // Request user location with spoken heads-up
  const requestLocation = useCallback(async () => {
    setStepState('AWAITING_LOCATION');
    setStatusMessage('Requesting location access...');

    // Requirement 2: Speak why before requesting location
    await speak('I need your location to find nearby places.');
    await new Promise((r) => setTimeout(r, 200));

    if (!('geolocation' in navigator)) {
      setStepState('LOCATION_DENIED');
      setErrorMessage('Geolocation is not supported by your browser.');
      await speak(
        'Location services are not supported on this device. You can say Home to return to the main screen.'
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

        // Requirement 1 & 3: Prompt user for place search query
        setStatusMessage('Listening for place type...');
        await speak(
          "Place Finder. Tell me what you're looking for, like pharmacy, restaurant, or bus stop."
        );
      },
      async (err) => {
        console.warn('Geolocation error:', err);
        setStepState('LOCATION_DENIED');
        setErrorMessage('Location permission denied or position unavailable.');
        setStatusMessage('Location access required.');

        // Requirement 2: Clear failure message if location denied
        await speak(
          'Location access was denied or unavailable. Place Finder requires location access to search nearby places. Say Home to return to the main screen.'
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, [speak, setStatusMessage]);

  // Initial load
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      requestLocation();
    }
  }, [requestLocation]);

  // Perform search call to server API
  const performSearch = useCallback(
    async (rawQuery: string) => {
      const cleanedQuery = cleanPlaceQuery(rawQuery);
      if (!cleanedQuery) return;

      setCurrentQuery(cleanedQuery);
      setStepState('SEARCHING');
      setErrorMessage(null);

      // Requirement 3: Speak confirmation of what was understood
      setStatusMessage(`Searching for ${cleanedQuery}...`);
      await speak(`Looking for ${cleanedQuery} near you.`);

      const currentLoc = coordsRef.current;
      if (!currentLoc) {
        await speak('Location is missing. Let me check your position again.');
        requestLocation();
        return;
      }

      try {
        const res = await fetch(
          `/api/places/nearby?lat=${currentLoc.lat}&lng=${currentLoc.lng}&query=${encodeURIComponent(
            cleanedQuery
          )}`
        );
        const data = await res.json();

        if (res.ok && Array.isArray(data.places) && data.places.length > 0) {
          const foundPlaces: Place[] = data.places.slice(0, 5);
          setPlaces(foundPlaces);
          setStepState('RESULTS_READY');
          setStatusMessage(`Found ${foundPlaces.length} places nearby.`);

          // Requirement 4: Speak top results one at a time with name, distance, and direction
          let spokenText = `Found ${foundPlaces.length} results. `;
          foundPlaces.forEach((p, idx) => {
            const dirString = p.directionText ? `, to your ${p.directionText}` : '';
            spokenText += `Number ${idx + 1}: ${p.name}, ${p.distanceMeters} meters away${dirString}. `;
          });

          spokenText +=
            "Say the name of the place, or its number, to get directions, or say 'search again' to look for something else.";

          await speakChunks(spokenText);
        } else {
          // Requirement 6: No results found error handling
          setStepState('PROMPTING_QUERY');
          setStatusMessage('No places found.');
          await speak(
            `I couldn't find any ${cleanedQuery} nearby. Try a different place or say search again.`
          );
        }
      } catch (err) {
        console.error('Nearby places search error:', err);
        setStepState('PROMPTING_QUERY');
        setStatusMessage('Search failed.');
        // Requirement 6: API failure error handling
        await speak(
          "I'm having trouble searching right now, please try again in a moment."
        );
      }
    },
    [speak, speakChunks, setStatusMessage, requestLocation]
  );

  // Fetch directions route for selected place
  const fetchDirections = useCallback(
    async (place: Place) => {
      setSelectedPlace(place);
      setStepState('LOADING_DIRECTIONS');
      setStatusMessage(`Calculating route to ${place.name}...`);

      // Requirement 5: Spoken confirmation when selected
      await speak(`Getting directions to ${place.name}.`);

      const currentLoc = coordsRef.current;
      if (!currentLoc) {
        await speak('Location is missing. Retrying location...');
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
          setStatusMessage(`Directions ready for ${place.name}.`);

          // Requirement 5: Speak route summary first (distance & duration)
          const summarySpeech = `Route to ${place.name}. Total distance: ${routeData.totalDistanceText}. Estimated walking time: ${routeData.totalDurationText}.`;
          await speak(summarySpeech);

          // Speak first turn-by-turn instruction
          const firstStep = routeData.steps[0];
          await speak(
            `Step 1: ${firstStep.instruction}. Walk ${firstStep.distanceText}. Say 'next' for the next direction, or 'repeat' to hear this again.`
          );
        } else {
          setStepState('RESULTS_READY');
          setStatusMessage('Could not fetch directions.');
          await speak(
            `I could not get directions to ${place.name}. Say 'search again' to look for another place.`
          );
        }
      } catch (err) {
        console.error('Directions API error:', err);
        setStepState('RESULTS_READY');
        setStatusMessage('Directions request failed.');
        await speak(
          "I'm having trouble calculating directions right now. Please try again or say search again."
        );
      }
    },
    [speak, setStatusMessage, requestLocation]
  );

  // Next direction command handler
  const handleNextDirection = useCallback(async () => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.steps.length === 0) {
      await speak('No active directions. Say search again to find a place.');
      return;
    }

    const nextIdx = currentStepIndexRef.current + 1;
    if (nextIdx >= currentRoute.steps.length) {
      await speak(
        `You have reached the final direction for ${currentRoute.destinationName}. You are arriving at your destination.`
      );
      return;
    }

    setCurrentStepIndex(nextIdx);
    const step = currentRoute.steps[nextIdx];
    setStatusMessage(`Step ${nextIdx + 1} of ${currentRoute.steps.length}`);
    await speak(
      `Step ${nextIdx + 1}: ${step.instruction}. Walk ${step.distanceText}.`
    );
  }, [speak, setStatusMessage]);

  // Previous direction command handler
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

  // Repeat direction command handler
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
      `Step ${idx + 1} of ${currentRoute.steps.length}: ${step.instruction}. Walk ${step.distanceText}.`
    );
  }, [selectedPlace, speak]);

  // Search again reset handler
  const handleSearchAgain = useCallback(async () => {
    setPlaces([]);
    setSelectedPlace(null);
    setRoute(null);
    setCurrentQuery('');
    setStepState('PROMPTING_QUERY');
    setStatusMessage('Ready for new place search.');
    await speak("Okay, what place are you looking for?");
  }, [speak, setStatusMessage]);

  // Voice Command Listener Registration
  useEffect(() => {
    const unregister = registerCommandListener((transcript: string) => {
      const norm = transcript.toLowerCase().trim();
      const state = stepStateRef.current;

      console.log(`[PlaceFinder Command Listener] State: ${state}, Input: "${norm}"`);

      // 1. Check for Re-try / Cancel prompt keywords
      if (
        norm.includes('no try again') ||
        norm.includes('try again') ||
        norm.includes('search again') ||
        norm.includes('new search') ||
        norm.includes('start over')
      ) {
        handleSearchAgain();
        return true;
      }

      // 2. Check for Repeat direction command
      if (
        norm.includes('repeat') ||
        norm.includes('read again') ||
        norm.includes('say again') ||
        norm.includes('repeat step')
      ) {
        handleRepeatDirection();
        return true;
      }

      // 3. Check for Next direction command
      if (
        norm.includes('next direction') ||
        norm.includes('next step') ||
        norm.includes('next') ||
        norm.includes('forward')
      ) {
        handleNextDirection();
        return true;
      }

      // 4. Check for Previous direction command
      if (
        norm.includes('previous direction') ||
        norm.includes('previous step') ||
        norm.includes('previous') ||
        norm.includes('back step')
      ) {
        handlePrevDirection();
        return true;
      }

      // 5. Handling choice selection when results are ready
      if (state === 'RESULTS_READY') {
        const currentPlaceList = placesRef.current;

        // Try number choice first
        const choiceIdx = parsePlaceChoiceIndex(norm, currentPlaceList.length);
        if (choiceIdx !== null && choiceIdx < currentPlaceList.length) {
          const chosen = currentPlaceList[choiceIdx];
          fetchDirections(chosen);
          return true;
        }

        // Try fuzzy name match
        const matchedByName = matchPlaceByName(norm, currentPlaceList);
        if (matchedByName) {
          fetchDirections(matchedByName);
          return true;
        }

        // Requirement 6: Ambiguous selection error handling
        speak(
          "I didn't catch which place you meant — please say the number or the place name again."
        );
        return true;
      }

      // 6. Handling query search input when prompting for query or location ready
      if (state === 'PROMPTING_QUERY' || state === 'AWAITING_LOCATION') {
        // Exclude global navigation keywords
        if (
          norm === 'home' ||
          norm === 'go back' ||
          norm === 'help' ||
          norm === 'place finder'
        ) {
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
    handleSearchAgain,
    handleRepeatDirection,
    handleNextDirection,
    handlePrevDirection,
    fetchDirections,
    performSearch,
    speak,
  ]);

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-6 sm:px-8 space-y-8 pb-16">
      {/* Voice Assistant Monitor Header */}
      <VoiceStatusCard />

      {/* Main Feature Container */}
      <section className="bg-zinc-900 border-4 border-zinc-700 rounded-[36px] p-6 sm:p-10 space-y-8 shadow-[0_10px_40px_rgba(0,0,0,0.6)] transition-all">
        {/* Header Header Info */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b-2 border-zinc-800">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-14 h-14 bg-yellow-500 text-black rounded-2xl flex items-center justify-center font-black shadow-lg">
              <MapPin className="w-8 h-8 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-yellow-500 font-extrabold text-xs uppercase tracking-widest block">
                Accessibility Navigation • Phase 3
              </span>
              <h1 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tight">
                Place Finder
              </h1>
            </div>
          </div>

          <button
            onClick={() => executeCommand('GO_BACK')}
            className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm uppercase tracking-wider rounded-xl transition-all border border-zinc-600 flex items-center gap-2 cursor-pointer focus:ring-4 focus:ring-yellow-500"
          >
            <ArrowLeft className="w-5 h-5 text-yellow-400" />
            <span>Home</span>
          </button>
        </div>

        {/* Step State 1: Location Access Denied Error Screen */}
        {stepState === 'LOCATION_DENIED' && (
          <div className="bg-red-950/40 border-2 border-red-500/50 rounded-3xl p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-2xl mx-auto flex items-center justify-center border border-red-500/40">
              <AlertCircle className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white uppercase">
                Location Access Required
              </h2>
              <p className="text-zinc-300 max-w-lg mx-auto text-base">
                {errorMessage ||
                  'Place Finder needs location permission to search for nearby pharmacies, restaurants, or bus stops.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-4 pt-2">
              <button
                onClick={requestLocation}
                className="px-6 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase text-base rounded-2xl transition-all focus:ring-4 focus:ring-yellow-500 cursor-pointer flex items-center gap-2"
              >
                <Compass className="w-5 h-5" />
                <span>Grant Location Permission</span>
              </button>
              <button
                onClick={() => executeCommand('GO_BACK')}
                className="px-6 py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-base rounded-2xl transition-all border border-zinc-600 cursor-pointer flex items-center gap-2"
              >
                <ArrowLeft className="w-5 h-5 text-yellow-400" />
                <span>Say "Home" to Exit</span>
              </button>
            </div>
          </div>
        )}

        {/* Step State 2: Query Prompting & Category Shortcuts */}
        {(stepState === 'PROMPTING_QUERY' || stepState === 'SEARCHING') && (
          <div className="space-y-6">
            <div className="bg-zinc-950/80 border-2 border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-4 text-center">
              <div className="w-12 h-12 bg-yellow-500/10 text-yellow-400 rounded-2xl mx-auto flex items-center justify-center border border-yellow-500/30">
                <Search className="w-6 h-6" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight">
                What are you looking for?
              </h2>
              <p className="text-yellow-400 text-base sm:text-lg font-extrabold max-w-md mx-auto">
                Speak naturally or tap a category: "Pharmacy", "Restaurant", "Bus Stop", "Café"
              </p>

              {/* Manual text input fallback */}
              <div className="max-w-md mx-auto flex gap-2 pt-2">
                <input
                  type="text"
                  placeholder="e.g. Pharmacy, Restaurant..."
                  value={currentQuery}
                  onChange={(e) => setCurrentQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && performSearch(currentQuery)}
                  className="flex-1 bg-zinc-900 border-2 border-zinc-700 rounded-xl px-4 py-3 text-white text-base focus:border-yellow-500 focus:outline-none"
                />
                <button
                  onClick={() => performSearch(currentQuery)}
                  disabled={stepState === 'SEARCHING'}
                  className="px-5 py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-black uppercase rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  {stepState === 'SEARCHING' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Search className="w-5 h-5" />
                  )}
                  <span>Search</span>
                </button>
              </div>
            </div>

            {/* Common Category Quick Chips */}
            <div className="space-y-2">
              <span className="text-xs font-black text-zinc-400 uppercase tracking-wider block">
                Quick Category Suggestions:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['Pharmacy', 'Restaurant', 'Bus Stop', 'Café'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => performSearch(cat)}
                    disabled={stepState === 'SEARCHING'}
                    className="p-4 bg-zinc-950 hover:bg-zinc-800 border-2 border-zinc-800 hover:border-yellow-500/60 rounded-2xl text-left transition-all group cursor-pointer focus:ring-4 focus:ring-yellow-500"
                  >
                    <span className="text-xs text-zinc-500 uppercase font-black block group-hover:text-yellow-400">
                      Say or Tap
                    </span>
                    <span className="text-base sm:text-lg font-black text-white group-hover:text-yellow-400">
                      {cat}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step State 3: Nearby Places Search Results List */}
        {(stepState === 'RESULTS_READY' || stepState === 'LOADING_DIRECTIONS') && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-2">
                <ListOrdered className="w-5 h-5 text-yellow-400" />
                <span className="text-white font-extrabold text-base uppercase">
                  Top Results for "{currentQuery}"
                </span>
              </div>
              <button
                onClick={handleSearchAgain}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 font-bold text-xs uppercase tracking-wider rounded-xl transition-all border border-zinc-700 flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Say "Search Again"</span>
              </button>
            </div>

            <div className="space-y-4">
              {places.map((place, idx) => (
                <div
                  key={place.id}
                  onClick={() => fetchDirections(place)}
                  className="bg-zinc-950 hover:bg-zinc-800/80 border-3 border-zinc-800 hover:border-yellow-500 rounded-3xl p-5 sm:p-6 transition-all cursor-pointer group flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md focus:ring-4 focus:ring-yellow-500"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-yellow-500 text-black font-black text-lg rounded-xl flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-lg sm:text-xl font-black text-white group-hover:text-yellow-400 transition-colors">
                        {place.name}
                      </h3>
                      <p className="text-zinc-400 text-sm">{place.vicinity}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 text-yellow-400 font-extrabold text-xs rounded-full">
                          {place.distanceMeters} meters away
                        </span>
                        {place.directionText && (
                          <span className="px-3 py-1 bg-zinc-900 border border-zinc-700 text-zinc-300 font-bold text-xs rounded-full capitalize">
                            Direction: {place.directionText}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    disabled={stepState === 'LOADING_DIRECTIONS'}
                    className="w-full sm:w-auto px-5 py-3 bg-yellow-500 group-hover:bg-yellow-400 text-black font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                  >
                    <Navigation className="w-4 h-4 fill-black" />
                    <span>Get Directions</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step State 4: Active Route Directions View */}
        {stepState === 'READING_DIRECTIONS' && route && (
          <div className="space-y-6">
            {/* Route Summary Banner */}
            <div className="bg-zinc-950 border-2 border-yellow-500/60 rounded-3xl p-6 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <Navigation className="w-6 h-6 text-yellow-400 fill-yellow-400" />
                  <div>
                    <span className="text-xs font-black text-zinc-400 uppercase tracking-widest block">
                      Active Navigation
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black text-white uppercase">
                      {route.destinationName}
                    </h2>
                  </div>
                </div>

                <button
                  onClick={handleSearchAgain}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 font-bold text-xs uppercase tracking-wider rounded-xl transition-all border border-zinc-700 flex items-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Search Again</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="bg-zinc-900 p-3 rounded-2xl border border-zinc-800">
                  <span className="text-xs font-black text-zinc-500 uppercase block">
                    Total Distance
                  </span>
                  <span className="text-lg font-black text-yellow-400">
                    {route.totalDistanceText}
                  </span>
                </div>
                <div className="bg-zinc-900 p-3 rounded-2xl border border-zinc-800">
                  <span className="text-xs font-black text-zinc-500 uppercase block">
                    Est. Walking Time
                  </span>
                  <span className="text-lg font-black text-yellow-400">
                    {route.totalDurationText}
                  </span>
                </div>
              </div>
            </div>

            {/* Active Turn-by-Turn Instruction Card */}
            <div className="bg-yellow-500 text-black border-4 border-yellow-400 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 bg-black text-yellow-400 font-black text-xs uppercase tracking-wider rounded-full">
                  Step {currentStepIndex + 1} of {route.steps.length}
                </span>
                <span className="text-xs font-black uppercase text-zinc-900">
                  Say "Next" or "Repeat"
                </span>
              </div>

              <p className="text-2xl sm:text-3xl font-black leading-snug">
                {route.steps[currentStepIndex]?.instruction}
              </p>

              <div className="pt-2 flex items-center justify-between text-sm font-black border-t-2 border-black/20">
                <span>Distance: {route.steps[currentStepIndex]?.distanceText}</span>
                <span>Est: {route.steps[currentStepIndex]?.durationText}</span>
              </div>
            </div>

            {/* Manual Navigation Controls for Screen Reader or Tap Access */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <button
                onClick={handlePrevDirection}
                disabled={currentStepIndex === 0}
                className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white font-black text-sm uppercase tracking-wider rounded-xl transition-all border border-zinc-600 flex items-center gap-2 cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 text-yellow-400" />
                <span>Previous Step</span>
              </button>

              <button
                onClick={handleRepeatDirection}
                className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 font-black text-sm uppercase tracking-wider rounded-xl transition-all border border-zinc-600 flex items-center gap-2 cursor-pointer"
              >
                <Volume2 className="w-5 h-5" />
                <span>Repeat Voice Step</span>
              </button>

              <button
                onClick={handleNextDirection}
                disabled={currentStepIndex >= route.steps.length - 1}
                className="px-5 py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-black font-black text-sm uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Next Step</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};
