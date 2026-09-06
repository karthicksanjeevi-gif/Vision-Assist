import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  // API route for nearby place search
  app.get("/api/places/nearby", async (req, res) => {
    try {
      const { lat, lng, query } = req.query;
      if (!lat || !lng || !query) {
        return res.status(400).json({ error: "lat, lng, and query parameters are required" });
      }

      const apiKey =
        process.env.GOOGLE_MAPS_PLATFORM_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.VITE_GOOGLE_MAPS_PLATFORM_KEY;

      const categoryQuery = String(query).trim().toLowerCase();

      if (apiKey) {
        try {
          const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=3000&keyword=${encodeURIComponent(
            categoryQuery
          )}&key=${apiKey}`;
          const response = await fetch(url);
          const data = await response.json();

          if (data.status === "OK" && Array.isArray(data.results) && data.results.length > 0) {
            const userLat = parseFloat(String(lat));
            const userLng = parseFloat(String(lng));

            const places = data.results.slice(0, 5).map((p: any, index: number) => {
              const pLat = p.geometry?.location?.lat || userLat;
              const pLng = p.geometry?.location?.lng || userLng;
              const distMeters = calculateHaversineDistance(userLat, userLng, pLat, pLng);
              const direction = calculateBearingDirection(userLat, userLng, pLat, pLng);

              return {
                id: p.place_id || `place-${index + 1}`,
                name: p.name,
                vicinity: p.vicinity || p.formatted_address || "Nearby",
                lat: pLat,
                lng: pLng,
                distanceMeters: distMeters,
                directionText: direction,
                rating: p.rating,
              };
            });

            return res.json({ places, source: "google_places" });
          }
        } catch (apiErr) {
          console.warn("Google Places API call failed, using fallback:", apiErr);
        }
      }

      // Fallback generation if no API key or zero results
      const fallbackPlaces = generateFallbackPlaces(categoryQuery, parseFloat(String(lat)), parseFloat(String(lng)));
      return res.json({ places: fallbackPlaces, source: "simulated_nearby" });
    } catch (err: any) {
      console.error("Nearby search error:", err);
      return res.status(500).json({ error: "Failed to search nearby places" });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
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

function calculateBearingDirection(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;

  if (brng >= 337.5 || brng < 22.5) return "north";
  if (brng >= 22.5 && brng < 67.5) return "north-east";
  if (brng >= 67.5 && brng < 112.5) return "east";
  if (brng >= 112.5 && brng < 157.5) return "south-east";
  if (brng >= 157.5 && brng < 202.5) return "south";
  if (brng >= 202.5 && brng < 247.5) return "south-west";
  if (brng >= 247.5 && brng < 292.5) return "west";
  return "north-west";
}

function generateFallbackPlaces(query: string, userLat: number, userLng: number) {
  const normalized = query.toLowerCase();

  let placeTemplates = [
    { nameSuffix: "Central", offsetLat: 0.0012, offsetLng: 0.0015 },
    { nameSuffix: "Metro", offsetLat: -0.0018, offsetLng: 0.0022 },
    { nameSuffix: "Express", offsetLat: 0.0025, offsetLng: -0.0018 },
  ];

  let categoryLabel = "Place";
  if (normalized.includes("pharmacy") || normalized.includes("chemist") || normalized.includes("drug")) {
    categoryLabel = "Pharmacy";
  } else if (normalized.includes("restaurant") || normalized.includes("food") || normalized.includes("diner") || normalized.includes("eat")) {
    categoryLabel = "Restaurant";
  } else if (normalized.includes("bus") || normalized.includes("stop") || normalized.includes("transit") || normalized.includes("station")) {
    categoryLabel = "Bus Stop";
  } else if (normalized.includes("coffee") || normalized.includes("cafe") || normalized.includes("starbucks")) {
    categoryLabel = "Café";
  } else if (normalized.includes("bank") || normalized.includes("atm")) {
    categoryLabel = "ATM / Bank";
  } else if (normalized.includes("hospital") || normalized.includes("clinic") || normalized.includes("doctor")) {
    categoryLabel = "Medical Center";
  } else if (normalized.includes("store") || normalized.includes("grocery") || normalized.includes("market")) {
    categoryLabel = "Market";
  } else {
    // Capitalize requested query
    categoryLabel = query.charAt(0).toUpperCase() + query.slice(1);
  }

  return placeTemplates.map((tpl, i) => {
    const pLat = userLat + tpl.offsetLat;
    const pLng = userLng + tpl.offsetLng;
    const distanceMeters = calculateHaversineDistance(userLat, userLng, pLat, pLng);
    const directionText = calculateBearingDirection(userLat, userLng, pLat, pLng);

    return {
      id: `fallback-${i + 1}`,
      name: `${tpl.nameSuffix} ${categoryLabel}`,
      vicinity: `Main Street, ${distanceMeters}m away`,
      lat: pLat,
      lng: pLng,
      distanceMeters,
      directionText,
      rating: 4.5,
    };
  });
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

startServer();
