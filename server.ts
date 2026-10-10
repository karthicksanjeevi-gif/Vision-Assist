import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

export async function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // API route for full document image and OCR analysis using Gemini Vision
  app.post("/api/analyze-document", async (req, res) => {
    try {
      const { imageBase64, rawText } = req.body;
      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        const cleanText = rawText ? String(rawText).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() : "";
        return res.json({
          extractedText: cleanText || "Document image captured.",
          summary: generateFallbackSummary(cleanText),
          documentType: "Document",
          keyDetails: []
        });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      const contents: any[] = [];

      if (imageBase64 && typeof imageBase64 === "string") {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64
          }
        });
      }

      let textContext = "";
      if (rawText && typeof rawText === "string" && rawText.trim().length > 0) {
        textContext = `Raw OCR Text Hint: "${rawText.slice(0, 2000)}"`;
      }

      const prompt = `You are an expert accessibility document reader for blind and visually impaired users.
Analyze this document image clearly, accurately, and thoroughly. ${textContext}

Tasks:
1. Transcribe ALL visible text accurately from top to bottom. Fix any minor glare, optical blur, or OCR typos so the text is crystal clear.
2. Identify the document type (e.g., 'ID Card', 'Utility Bill', 'Receipt', 'Medical Form', 'Contract / Agreement', 'Notice / Letter', 'Book / Paper').
3. Create a short, clear, spoken-friendly summary (2 to 4 sentences max) explaining what this document is, key terms/obligations, total amounts, due dates, or required signature items.
4. List 2 to 4 key bullet point facts (e.g., "Total Due: $50.00", "Due Date: August 15", "Signature Required: Yes").

Return your response strictly as a JSON object matching this structure:
{
  "extractedText": "full clean transcribed text here...",
  "summary": "concise spoken summary here...",
  "documentType": "Document Type Label",
  "keyDetails": ["Key Detail 1", "Key Detail 2"]
}

Important: Return ONLY valid, raw JSON without markdown backticks or commentary.`;

      contents.push(prompt);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
      });

      const responseText = response.text || "";
      const cleanJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any = {};
      try {
        parsed = JSON.parse(cleanJson);
      } catch (parseErr) {
        console.warn("Failed to parse Gemini vision JSON output, using fallback format:", responseText);
        parsed = {
          extractedText: rawText || responseText,
          summary: responseText,
          documentType: "Document",
          keyDetails: []
        };
      }

      return res.json({
        extractedText: parsed.extractedText || rawText || "No text detected in document.",
        summary: parsed.summary || generateFallbackSummary(parsed.extractedText || rawText || ""),
        documentType: parsed.documentType || "Document",
        keyDetails: Array.isArray(parsed.keyDetails) ? parsed.keyDetails : []
      });
    } catch (err: any) {
      console.error("Document analysis endpoint error:", err);
      const cleanText = req.body.rawText ? String(req.body.rawText).trim() : "";
      return res.json({
        extractedText: cleanText || "Unable to read document image clearly.",
        summary: generateFallbackSummary(cleanText),
        documentType: "Document",
        keyDetails: []
      });
    }
  });

  // API route for document operations (summary, advantages, disadvantages)
  app.post("/api/document-operation", async (req, res) => {
    try {
      const { text, operation, imageBase64 } = req.body;
      if (!text && !imageBase64) {
        return res.status(400).json({ error: "Text or image is required" });
      }

      const requestedOp = String(operation || "summary").toLowerCase();
      const docContent = String(text || "").slice(0, 4000);
      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;

      let opTitle = "Document Summary";
      if (requestedOp.includes("advantage") && requestedOp.includes("disadvantage")) {
        opTitle = "Advantages & Disadvantages";
      } else if (requestedOp.includes("disadvantage") || requestedOp.includes("con")) {
        opTitle = "Document Disadvantages & Risks";
      } else if (requestedOp.includes("advantage") || requestedOp.includes("pro")) {
        opTitle = "Document Advantages & Benefits";
      }

      if (!apiKey) {
        // Intelligent fallback
        const fallback = generateFallbackDocOperation(docContent, requestedOp);
        return res.json({
          operationTitle: opTitle,
          ...fallback
        });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      let systemPrompt = "";

      if (requestedOp.includes("advantage") && requestedOp.includes("disadvantage")) {
        systemPrompt = `You are an accessibility assistant analyzing a scanned document for a user.
Analyze the provided document text/image and extract:
1. "advantages": A list of 2 to 5 clear advantages, benefits, user rights, free offers, discounts, or perks in this document.
2. "disadvantages": A list of 2 to 5 potential disadvantages, costs, fees, penalties, strict deadlines, obligations, or risks.
3. "spokenResult": A clear, spoken statement (3-5 sentences max) summarizing both the main advantages and disadvantages clearly.

Return strictly raw JSON with keys: "spokenResult", "advantages", "disadvantages". No markdown formatting or commentary.`;
      } else if (requestedOp.includes("disadvantage") || requestedOp.includes("con")) {
        systemPrompt = `You are an accessibility assistant analyzing a scanned document for a user.
Analyze the provided document text/image and extract:
1. "disadvantages": A list of 2 to 6 potential disadvantages, costs, fees, penalties, late charges, strict deadlines, liabilities, or risks in this document.
2. "spokenResult": A clear, spoken statement (2-4 sentences max) explaining the main disadvantages and risks of this document.

Return strictly raw JSON with keys: "spokenResult", "disadvantages". No markdown formatting or commentary.`;
      } else if (requestedOp.includes("advantage") || requestedOp.includes("pro")) {
        systemPrompt = `You are an accessibility assistant analyzing a scanned document for a user.
Analyze the provided document text/image and extract:
1. "advantages": A list of 2 to 6 clear advantages, benefits, privileges, guarantees, discounts, or positive terms in this document.
2. "spokenResult": A clear, spoken statement (2-4 sentences max) explaining the main advantages and benefits of this document.

Return strictly raw JSON with keys: "spokenResult", "advantages". No markdown formatting or commentary.`;
      } else {
        systemPrompt = `You are an accessibility assistant analyzing a scanned document for a user.
Analyze the provided document text/image and extract:
1. "summary": A clear, plain language 3-4 sentence summary of what this document is, key terms, amounts, and dates.
2. "spokenResult": A spoken summary statement suitable for reading aloud to a blind user.

Return strictly raw JSON with keys: "spokenResult", "summary". No markdown formatting or commentary.`;
      }

      const contents: any[] = [];
      if (imageBase64 && typeof imageBase64 === "string") {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64
          }
        });
      }
      contents.push(`${systemPrompt}\n\nDocument Text:\n${docContent}`);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
      });

      const rawResp = response.text || "";
      const cleanJson = rawResp.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any = {};
      try {
        parsed = JSON.parse(cleanJson);
      } catch (pErr) {
        parsed = { spokenResult: rawResp };
      }

      return res.json({
        operationTitle: opTitle,
        spokenResult: parsed.spokenResult || "Analysis complete.",
        summary: parsed.summary || null,
        advantages: Array.isArray(parsed.advantages) ? parsed.advantages : [],
        disadvantages: Array.isArray(parsed.disadvantages) ? parsed.disadvantages : []
      });

    } catch (err: any) {
      console.error("Document operation API error:", err);
      const fallback = generateFallbackDocOperation(req.body.text || "", req.body.operation || "");
      return res.json({
        operationTitle: "Document Analysis",
        ...fallback
      });
    }
  });

  // API route for full document summarization
  app.post("/api/summarize-document", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // Fallback summary if no API key set
        const fallback = generateFallbackSummary(text);
        return res.json({ summary: fallback });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are an accessibility assistant for blind and visually impaired users.
The user scanned a document that looks like a form, contract, application, or agreement.
Summarize this document in plain, conversational language. Include:
1. A concise overview of what this document is.
2. Key obligations, terms, eligibility, or signature requirements.
3. Brief pros/cons or critical action items if any.
Keep the output concise (4 to 6 spoken sentences max) so it is clear when read aloud.

Document Text:
${text.slice(0, 4000)}`,
      });

      const summaryText = response.text || "Summary could not be generated.";
      return res.json({ summary: summaryText });
    } catch (err: any) {
      console.error("Summarization API error:", err);
      // Return rule-based fallback summary so user isn't blocked
      return res.json({
        summary: generateFallbackSummary(req.body.text || "")
      });
    }
  });

  // API route for real-time obstacle detection from live video frame
  app.post("/api/live-navigation/detect", async (req, res) => {
    try {
      const { imageBase64, mode } = req.body;
      const navMode = String(mode || "indoor").toLowerCase();
      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "A camera image is required for obstacle detection." });
      }
      if (!apiKey) {
        return res.status(503).json({ error: "Cloud vision detection is not configured." });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");

      const prompt = `You are a real-time assistive vision and obstacle detection AI for a blind person walking or navigating indoors/outdoors.
Environment: ${navMode.toUpperCase()}.
Analyze this camera image carefully.

Identify whatever is in front of the camera:
- If a person or human is in front of the camera: Label as "Person" or "Pedestrian", distance in meters (e.g. 0.8m, 1.2m, 2m), clock direction (e.g. "12 o'clock"), tier 1 if close (< 1.5m) or tier 2.
- If indoor items (Desk, Laptop, Screen, Wall, Door, Cupboard, Chair, Table, Bed): State the item, distance, direction.
- If drop-offs or stairs: State "Downward Stairs" or "Drop-off", tier 1.
- If overhead hazards (low ceiling, branch, shelf): State overhead hazard, tier 1.

CRITICAL:
If there is a person, obstacle, furniture, or wall in the view, "clearPath" MUST be FALSE!
"clearPath" is true ONLY when there is completely open space with no obstacles within 3 meters.

Return strictly raw JSON (no backticks):
{
  "hazards": [
    {
      "id": "obs-1",
      "label": "Person directly in front",
      "category": "moving",
      "tier": 1,
      "distanceMeters": 0.9,
      "clockPosition": "12 o'clock",
      "directionText": "straight ahead",
      "pan": 0.0,
      "warningPhrase": "Person straight ahead, less than 1 meter away.",
      "box": { "x": 0.2, "y": 0.1, "width": 0.6, "height": 0.8 }
    }
  ],
  "clearPath": false,
  "clearPathDistanceMeters": 0.9,
  "summary": "Person directly in front of camera, 0.9 meters away."
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64,
            },
          },
          prompt,
        ],
      });

      const responseText = response.text || "";
      const cleanJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      let parsed: any = {};
      try {
        parsed = JSON.parse(cleanJson);
      } catch (err) {
        console.warn("Failed to parse detect JSON:", responseText);
        return res.status(502).json({ error: "Vision model returned an invalid detection response." });
      }

      console.log(`[LiveNav Detect] Mode: ${navMode}, Found ${parsed.hazards?.length || 0} hazards. Summary: "${parsed.summary}"`);

      return res.json({
        hazards: Array.isArray(parsed.hazards) ? parsed.hazards : [],
        clearPath: Boolean(parsed.clearPath),
        clearPathDistanceMeters: parsed.clearPathDistanceMeters,
        summary: parsed.summary || "No detection summary was provided.",
      });
    } catch (err: any) {
      console.error("Live navigation detect error:", err);
      if (err?.status === 429) {
        return res.status(429).json({ error: "Cloud vision quota is exhausted. Try again later." });
      }
      return res.status(502).json({ error: "Cloud vision obstacle detection failed." });
    }
  });

  // API route for Live Navigation scene description & spatial awareness
  app.post("/api/live-navigation/scene", async (req, res) => {
    try {
      const { imageBase64, mode } = req.body;
      const navMode = String(mode || "indoor").toLowerCase();
      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "A camera image is required for scene description." });
      }
      if (!apiKey) return res.status(503).json({ error: "Cloud scene description is not configured." });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");

      const prompt = `You are a real-time spatial navigation assistant for a blind pedestrian.
Operating mode: ${navMode.toUpperCase()}.
Analyze this camera frame captured chest-high from the user's perspective.
Provide a concise 2 to 3 sentence spatial description:
- State what type of room, hallway, or street environment this is.
- Specify visible obstacles, doors, stairs, ground obstacles, or pathways relative to the user (e.g., 'on your left', 'straight ahead').
- Only provide a rough visual distance estimate when supportable, and explicitly say distances are approximate because this is a single uncalibrated camera.
- Use clear, calm, spoken language directly addressing the pedestrian.
Keep it strictly under 50 words. Do not use bullet points or markdown.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64
            }
          },
          prompt
        ]
      });

      const description = response.text?.trim();
      if (!description) return res.status(502).json({ error: "Vision model returned no scene description." });
      return res.json({ description });
    } catch (err: any) {
      console.error("Live navigation scene error:", err);
      if (err?.status === 429) {
        return res.status(429).json({ error: "Cloud vision quota is exhausted. Try again later." });
      }
      return res.status(502).json({ error: "Cloud scene description failed." });
    }
  });

  // API route for target object localization (e.g. Find door, Find chair, Find stairs)
  app.post("/api/live-navigation/find", async (req, res) => {
    try {
      const { imageBase64, target } = req.body;
      const targetQuery = String(target || "door").toLowerCase();
      const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;

      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "A camera image is required to locate an object." });
      }
      if (!apiKey) return res.status(503).json({ error: "Cloud object localization is not configured." });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
      const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");

      const prompt = `You are an accessibility spatial localization assistant for a blind person looking for: "${targetQuery}".
Analyze this live camera view.
Determine:
1. Is "${targetQuery}" visible in the frame? (found: true/false)
2. Directional guidance: instructions on which way to turn or step (e.g. "Turn slightly right... hold steady... chair located 2 meters directly ahead.")
3. Estimated clock-face position (e.g., "11 o'clock", "12 o'clock", "2 o'clock")
4. Very rough visual distance estimate in meters. State that distance is approximate because this is a single uncalibrated camera.

Return strictly JSON matching:
{
  "found": true,
  "direction": "Spoken turn instructions here",
  "clockPosition": "12 o'clock",
  "distanceMeters": 2.0
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64
            }
          },
          prompt
        ]
      });

      const cleanJson = (response.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
      let parsed: any = {};
      try {
        parsed = JSON.parse(cleanJson);
      } catch (e) {
        return res.status(502).json({ error: "Vision model returned an invalid object-location response." });
      }

      return res.json(parsed);
    } catch (err: any) {
      console.error("Live navigation find error:", err);
      if (err?.status === 429) {
        return res.status(429).json({ error: "Cloud vision quota is exhausted. Try again later." });
      }
      return res.status(502).json({ error: "Cloud object localization failed." });
    }
  });

  // API route for nearby place search
  app.get("/api/places/nearby", async (req, res) => {
    try {
      const { lat, lng, query } = req.query;
      const userLat = Number(lat);
      const userLng = Number(lng);
      if (
        !Number.isFinite(userLat) ||
        !Number.isFinite(userLng) ||
        userLat < -90 ||
        userLat > 90 ||
        userLng < -180 ||
        userLng > 180 ||
        typeof query !== "string" ||
        !query.trim()
      ) {
        return res.status(400).json({ error: "lat, lng, and query parameters are required" });
      }

      const apiKey =
        process.env.GOOGLE_MAPS_PLATFORM_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.VITE_GOOGLE_MAPS_PLATFORM_KEY;

      const categoryQuery = query.trim();

      if (apiKey) {
        try {
          const params = new URLSearchParams({
            location: `${userLat},${userLng}`,
            radius: "3000",
            keyword: categoryQuery,
            key: apiKey,
          });
          const googleResults: any[] = [];
          let nextPageToken: string | undefined;

          for (let page = 0; page < 3; page += 1) {
            let pageParams = params;
            if (nextPageToken) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              pageParams = new URLSearchParams({
                pagetoken: nextPageToken,
                key: apiKey,
              });
            }

            const response = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${pageParams}`, {
              signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) throw new Error(`Google Places returned HTTP ${response.status}`);
            const data = await response.json();

            if (data.status !== "OK" || !Array.isArray(data.results)) break;
            googleResults.push(...data.results);
            nextPageToken = data.next_page_token;
            if (!nextPageToken) break;
          }

          if (googleResults.length > 0) {
            const places = googleResults.map((p: any, index: number) => {
              const pLat = p.geometry?.location?.lat;
              const pLng = p.geometry?.location?.lng;
              if (typeof pLat !== "number" || typeof pLng !== "number") return null;
              const distMeters = calculateHaversineDistance(userLat, userLng, pLat, pLng);
              const clockDirection = calculateClockDirection(userLat, userLng, pLat, pLng);
              const relativeDirection = calculateRelativeDirection(userLat, userLng, pLat, pLng);
              const isOpen = p.opening_hours?.open_now;
              const openStatus = isOpen === true ? "Open now" : isOpen === false ? "Closed now" : "Hours not listed";

              return {
                id: p.place_id || `google-place-${index + 1}`,
                name: p.name,
                vicinity: p.vicinity || p.formatted_address || "Nearby",
                lat: pLat,
                lng: pLng,
                distanceMeters: distMeters,
                directionText: relativeDirection,
                clockDirection: clockDirection,
                openStatus,
                rating: p.rating,
              };
            }).filter(Boolean).sort((left: any, right: any) => left.distanceMeters - right.distanceMeters).slice(0, 20);

            if (places.length > 0) return res.json({ places, source: "google_places" });
          }
        } catch (apiErr) {
          console.warn("Google Places API call failed; trying OpenStreetMap:", apiErr);
        }
      }

      const places = await searchOpenStreetMapPlaces(userLat, userLng, categoryQuery);
      return res.json({ places, source: "openstreetmap", radiusMeters: 3000 });
    } catch (err: any) {
      console.error("Nearby search error:", err);
      return res.status(502).json({ error: "Could not retrieve real nearby places. Check your connection and try again." });
    }
  });

  // API route for directions route calculation
  app.get("/api/directions", async (req, res) => {
    try {
      const { originLat, originLng, destLat, destLng, destName } = req.query;
      if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: "Missing origin or destination coordinates" });
      }

      const apiKey =
        process.env.GOOGLE_MAPS_PLATFORM_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.VITE_GOOGLE_MAPS_PLATFORM_KEY;

      const destinationName = String(destName || "Destination");

      if (apiKey) {
        try {
          const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=walking&key=${apiKey}`;
          const response = await fetch(url);
          const data = await response.json();

          if (data.status === "OK" && data.routes?.[0]?.legs?.[0]) {
            const leg = data.routes[0].legs[0];
            const steps = leg.steps.map((step: any) => {
              const cleanInstruction = (step.html_instructions || "")
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              return {
                instruction: cleanInstruction || `Head towards ${destinationName}`,
                distanceText: step.distance?.text || "100 meters",
                durationText: step.duration?.text || "2 mins",
              };
            });

            return res.json({
              destinationName,
              totalDistanceText: leg.distance?.text || "350 meters",
              totalDurationText: leg.duration?.text || "4 minutes",
              steps,
              source: "google_directions",
            });
          }
        } catch (apiErr) {
          console.warn("Google Directions API call failed, using fallback:", apiErr);
        }
      }

      // Fallback walking directions generator
      const fallbackRoute = generateFallbackDirections(destinationName);
      return res.json(fallbackRoute);
    } catch (err: any) {
      console.error("Directions error:", err);
      return res.status(500).json({ error: "Failed to calculate directions" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

if (process.env.VERCEL !== "1") {
  createApp().then((app) => {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  });
}

function generateFallbackSummary(text: string): string {
  const containsTerms = /terms|conditions/i.test(text);
  const containsAgreement = /agreement|contract|policy/i.test(text);
  const containsSignature = /signature|sign here|signed/i.test(text);
  const containsEligibility = /eligibility|qualif/i.test(text);

  let details = [];
  if (containsAgreement) details.push("It appears to be an official agreement or contract.");
  if (containsTerms) details.push("It includes terms and conditions.");
  if (containsSignature) details.push("A signature requirement was detected.");
  if (containsEligibility) details.push("It specifies eligibility or qualification criteria.");

  if (details.length === 0) {
    return "This document contains formal structured text with key obligations and terms.";
  }

  return `Here is a quick overview of the document: ${details.join(" ")}`;
}

function generateFallbackDocOperation(text: string, operation: string): {
  spokenResult: string;
  summary?: string;
  advantages: string[];
  disadvantages: string[];
} {
  const lower = text.toLowerCase();
  const isAdvDis = operation.includes("advantage") && operation.includes("disadvantage");
  const isDis = operation.includes("disadvantage") || operation.includes("con");
  const isAdv = operation.includes("advantage") || operation.includes("pro");

  const advantages: string[] = [];
  const disadvantages: string[] = [];

  if (lower.includes("free") || lower.includes("discount") || lower.includes("waived")) {
    advantages.push("Special offer, discount, or fee waiver mentioned.");
  }
  if (lower.includes("guarantee") || lower.includes("warranty") || lower.includes("refund")) {
    advantages.push("Consumer protection, warranty, or refund policy provided.");
  }
  if (lower.includes("flexible") || lower.includes("easy") || lower.includes("support")) {
    advantages.push("Flexible terms or user support services available.");
  }
  if (advantages.length === 0) {
    advantages.push("Official documentation provided for clear record keeping.");
    advantages.push("Clear terms outlining service rights.");
  }

  if (lower.includes("fee") || lower.includes("penalty") || lower.includes("charge") || lower.includes("due")) {
    disadvantages.push("Mandatory payment deadlines, interest fees, or late penalties apply.");
  }
  if (lower.includes("cancel") || lower.includes("termination") || lower.includes("expire")) {
    disadvantages.push("Expiration, cancellation fees, or strict termination clauses.");
  }
  if (lower.includes("require") || lower.includes("must") || lower.includes("obligation") || lower.includes("liability")) {
    disadvantages.push("Strict user obligations and binding legal liability.");
  }
  if (disadvantages.length === 0) {
    disadvantages.push("Requires careful compliance with stated terms.");
    disadvantages.push("Binding obligations upon agreement.");
  }

  let spokenResult = "";
  if (isAdvDis) {
    spokenResult = `Here are the key advantages and disadvantages of this document. Advantages include: ${advantages.join(" ")} Disadvantages include: ${disadvantages.join(" ")}`;
  } else if (isDis) {
    spokenResult = `Here are the key disadvantages and risks of this document: ${disadvantages.join(" ")}`;
  } else if (isAdv) {
    spokenResult = `Here are the key advantages and benefits of this document: ${advantages.join(" ")}`;
  } else {
    spokenResult = generateFallbackSummary(text);
  }

  return {
    spokenResult,
    summary: isAdvDis || isDis || isAdv ? undefined : generateFallbackSummary(text),
    advantages: isDis ? [] : advantages,
    disadvantages: isAdv ? [] : disadvantages
  };
}

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function calculateBearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function calculateRelativeDirection(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const brng = calculateBearingDegrees(lat1, lon1, lat2, lon2);
  // Assuming pedestrian facing forward/north as reference
  if (brng >= 337.5 || brng < 22.5) return "straight ahead";
  if (brng >= 22.5 && brng < 67.5) return "to your front-right";
  if (brng >= 67.5 && brng < 112.5) return "to your right";
  if (brng >= 112.5 && brng < 157.5) return "to your back-right";
  if (brng >= 157.5 && brng < 202.5) return "behind you";
  if (brng >= 202.5 && brng < 247.5) return "to your back-left";
  if (brng >= 247.5 && brng < 292.5) return "to your left";
  return "to your front-left";
}

function calculateClockDirection(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const brng = calculateBearingDegrees(lat1, lon1, lat2, lon2);
  const hour = Math.round(brng / 30) % 12;
  const clockNum = hour === 0 ? 12 : hour;
  return `${clockNum} o'clock`;
}

function calculateBearingDirection(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const brng = calculateBearingDegrees(lat1, lon1, lat2, lon2);
  if (brng >= 337.5 || brng < 22.5) return "north";
  if (brng >= 22.5 && brng < 67.5) return "north-east";
  if (brng >= 67.5 && brng < 112.5) return "east";
  if (brng >= 112.5 && brng < 157.5) return "south-east";
  if (brng >= 157.5 && brng < 202.5) return "south";
  if (brng >= 202.5 && brng < 247.5) return "south-west";
  if (brng >= 247.5 && brng < 292.5) return "west";
  return "north-west";
}

async function searchOpenStreetMapPlaces(userLat: number, userLng: number, query: string) {
  const normalized = query.toLowerCase();
  const around = `(around:3000,${userLat},${userLng})`;
  const selectors: string[] = [];
  const addSelector = (key: string, value: string) => {
    for (const elementType of ["node", "way", "relation"]) {
      selectors.push(`${elementType}${around}["${key}"="${value}"];`);
    }
  };

  if (/pharmacy|chemist|drugstore/.test(normalized)) {
    addSelector("amenity", "pharmacy");
  } else if (/bus stop|bus|transit/.test(normalized)) {
    addSelector("highway", "bus_stop");
    addSelector("public_transport", "platform");
    addSelector("public_transport", "station");
  } else if (/train|rail|metro|subway/.test(normalized)) {
    addSelector("railway", "station");
    addSelector("public_transport", "station");
  } else if (/restaurant|food|diner|eatery/.test(normalized)) {
    addSelector("amenity", "restaurant");
    addSelector("amenity", "fast_food");
  } else if (/cafe|coffee|bakery/.test(normalized)) {
    addSelector("amenity", "cafe");
    addSelector("shop", "bakery");
  } else if (/grocery|supermarket|market|convenience/.test(normalized)) {
    addSelector("shop", "supermarket");
    addSelector("shop", "convenience");
  } else if (/atm|bank/.test(normalized)) {
    addSelector("amenity", "atm");
    addSelector("amenity", "bank");
  } else if (/restroom|toilet|bathroom/.test(normalized)) {
    addSelector("amenity", "toilets");
  } else if (/hospital|clinic|doctor|medical/.test(normalized)) {
    addSelector("amenity", "hospital");
    addSelector("amenity", "clinic");
    addSelector("amenity", "doctors");
  } else {
    const escapedQuery = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const elementType of ["node", "way", "relation"]) {
      for (const key of ["name", "brand", "operator"]) {
        selectors.push(`${elementType}${around}["${key}"~"${escapedQuery}",i];`);
      }
    }
  }

  const overpassQuery = `[out:json][timeout:18];(${selectors.join("")});out center tags;`;
  const overpassEndpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  let data: any;
  let lastError: unknown;

  for (const endpoint of overpassEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "VisionAssist Place Finder",
        },
        body: new URLSearchParams({ data: overpassQuery }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`OpenStreetMap Overpass returned HTTP ${response.status}`);
      data = await response.json();
      break;
    } catch (error) {
      lastError = error;
      console.warn(`OpenStreetMap Overpass request failed at ${endpoint}:`, error);
    }
  }

  if (!data) throw lastError instanceof Error ? lastError : new Error("All OpenStreetMap Overpass services are unavailable.");

  const elements = Array.isArray(data.elements) ? data.elements : [];
  const places = elements
    .map((element: any) => {
      const placeLat = element.lat ?? element.center?.lat;
      const placeLng = element.lon ?? element.center?.lon;
      if (typeof placeLat !== "number" || typeof placeLng !== "number") return null;

      const tags = element.tags || {};
      const name = tags.name || tags.brand || tags.operator;
      if (typeof name !== "string" || !name.trim()) return null;

      const distanceMeters = calculateHaversineDistance(userLat, userLng, placeLat, placeLng);
      return {
        id: `osm-${element.type}-${element.id}`,
        name,
        vicinity: [tags["addr:street"], tags["addr:city"]].filter(Boolean).join(", ") || "Address not listed",
        lat: placeLat,
        lng: placeLng,
        distanceMeters,
        directionText: calculateRelativeDirection(userLat, userLng, placeLat, placeLng),
        clockDirection: calculateClockDirection(userLat, userLng, placeLat, placeLng),
        openStatus: tags.opening_hours || undefined,
      };
    })
    .filter((place: any): place is NonNullable<typeof place> => place !== null)
    .sort((left: any, right: any) => left.distanceMeters - right.distanceMeters);

  const uniquePlaces = places.filter(
    (place: any, index: number, all: any[]) => all.findIndex((candidate) => candidate.name === place.name) === index,
  );
  return uniquePlaces.slice(0, 20);
}

function generateFallbackDirections(destName: string) {
  return {
    destinationName: destName,
    totalDistanceText: "320 meters",
    totalDurationText: "4 minutes",
    steps: [
      {
        instruction: `Head north on Main Street toward 1st Avenue`,
        distanceText: "100 meters",
        durationText: "1 min",
      },
      {
        instruction: `Turn right onto 1st Avenue and walk past the crosswalk`,
        distanceText: "140 meters",
        durationText: "2 mins",
      },
      {
        instruction: `Turn left onto Central Way. ${destName} will be on your right`,
        distanceText: "80 meters",
        durationText: "1 min",
      },
    ],
    source: "simulated_route",
  };
}
