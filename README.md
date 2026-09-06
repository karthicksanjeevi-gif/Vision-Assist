<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# VisionAssist

Voice-first document reading and navigation assistant with a server-side Gemini API.

View your app in AI Studio: https://ai.studio/apps/9a1a6f0b-f448-489b-bc77-46125c2d6c3f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create a `.env` file and add your local secrets:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   GOOGLE_MAPS_PLATFORM_KEY=your_google_maps_key
   ```
3. Run the app:
   `npm run dev`

## Deploy to Vercel

GitHub stores the source code, while Vercel must host both the frontend and the `/api` serverless function. GitHub Pages alone cannot run the Express/Gemini backend.

1. Import this GitHub repository into Vercel.
2. Keep the build command as `npm run build` and the output directory as `dist`.
3. In Vercel, open **Project Settings > Environment Variables** and add these variables for every environment you use:
   - `GEMINI_API_KEY`
   - `GOOGLE_MAPS_PLATFORM_KEY`
4. Redeploy after adding or changing variables.

Do not prefix these server-only variables with `VITE_`. The browser calls relative `/api/...` URLs, and the keys are read only by the Vercel serverless function.
