import dotenv from "dotenv";
dotenv.config();
import { GoogleGenAI } from "@google/genai";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Testing with API Key length:", apiKey?.length);
  const ai = new GoogleGenAI({ apiKey });
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Tell me what objects you see in a typical room. Return JSON with key objects: string[]."
    });
    console.log("Result:", res.text);
  } catch (err) {
    console.error("Test Error:", err);
  }
}

test();
