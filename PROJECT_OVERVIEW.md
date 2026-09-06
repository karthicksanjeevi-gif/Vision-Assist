# VisionAssist: Voice-Guided AI Assistant & Document Reader

## 1. Project Title
**VisionAssist** — Voice-First Accessible AI Document Reader & Navigation Assistant for Blind & Visually Impaired Users.

---

## 2. Problem Statement
Blind and visually impaired individuals face significant barriers in navigating daily environments, interpreting printed documents, reading contracts/forms, and scanning QR or barcodes. Standard web and mobile interfaces heavily rely on visual inputs, touch targets, and complex submenus that are difficult to operate without visual feedback. Furthermore, conventional screen readers often stop listening during speech output, creating frustrating interaction pauses or requiring manual gestures to reactivate microphone input.

---

## 3. Real Life Examples & Use Cases
1. **Reading Printed Mail and Contracts**: A visually impaired user receives a medical bill or legal agreement in the mail. VisionAssist reads the raw text aloud instantly and provides a plain-language AI summary highlighting key obligations and payment terms.
2. **Identifying Products and QR Links**: A user scans a packaged item or table sign with a QR code or barcode. VisionAssist detects the code, reads the product details or web link aloud, and prompts for voice confirmation before navigating.
3. **Hands-Free Daily Assistance**: A user operates the entire application completely hands-free using simple natural speech commands ("Scan Document", "Scan Code", "Read Again", "Capture", "Home"), eliminating reliance on mouse clicks or screen swipes.

---

## 4. Objectives
- **Persistent Voice Access**: Provide a continuous, non-stop speech recognition loop that remains active throughout app navigation and text-to-speech output without requiring manual reactivation.
- **Instant Document Digitization**: Enable real-time Optical Character Recognition (OCR) to extract and read physical text from mail, paper forms, and cards aloud.
- **Intelligent Document Summarization**: Leverage Gemini Generative AI to condense dense contracts, forms, and agreements into clear, plain-language spoken summaries.
- **Automated QR & Barcode Recognition**: Detect codes in real time from live camera feeds and speak contents or destination links with explicit voice confirmation before navigating.
- **Pre-Action Audio Transparency**: Announce system actions (such as camera permission requests) before execution to ensure user clarity and trust.
- **High-Contrast Inclusive Design**: Maintain WCAG-compliant high-contrast visual styling for partially sighted users and assisting companions.

---

## 5. Solutions Provided
- **Always-On Persistent Voice Shell**: Continuous speech recognition loop supported by an automatic watchdog timer that keeps microphone access active across page transitions and TTS playback.
- **Spoken Pre-Action Heads-Up**: Spoken feedback prior to system events (e.g., *"I need access to your camera to scan the document"*).
- **Client-Side Optical Character Recognition (OCR)**: In-browser text extraction using Tesseract.js.
- **Form & Contract AI Summarizer**: Automated detection of legal/formal keywords with LLM plain-language breakdown via server-side Gemini proxy (`/api/summarize`).
- **Live Code Scanning**: Real-time QR and barcode detection with spoken confirmation before opening URLs.
- **High-Contrast Accessible UI**: High-contrast black/yellow design adhering to WCAG contrast standards for sighted helpers and partially sighted users.

---

## 6. Technologies Used
- **Frontend Framework**: React 18 with TypeScript, Vite, Tailwind CSS, Lucide Icons
- **Voice & Speech Engine**: Web Speech API (`SpeechRecognition`, `window.speechSynthesis`)
- **Computer Vision & Scanning**: Tesseract.js (OCR), jsQR, Native BarcodeDetector API, WebRTC `getUserMedia`
- **Backend & AI Server**: Node.js, Express, `@google/genai` (Gemini 2.5 Flash API), `tsx` / `esbuild`
- **State Management**: React Context API (`VoiceContext`), TypeScript Custom Hooks

---

## 7. Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                 USER INTERACTION                                  |
|               (Voice Commands & High-Contrast Touch Controls)                     |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
|                                VOICE CONTEXT ENGINE                               |
|  - SpeechRecognition (Web Speech API)       - SpeechSynthesis (TTS Engine)        |
|  - Continuous Watchdog Loop (1.2s Heartbeat) - Page-Specific Custom Command Router|
+-----------------------------------------------------------------------------------+
       │                                  │                                  │
       ▼                                  ▼                                  ▼
+-----------------------+      +-----------------------+      +-----------------------+
|   DOCUMENT READER     |      |     CODE SCANNER      |      |     NAVIGATION &      |
|     (DocReader)       |      |    (QR / Barcode)     |      |     GLOBAL ROUTER     |
+-----------------------+      +-----------------------+      +-----------------------+
       │                                  │                                  │
       ▼                                  ▼                                  ▼
+-----------------------+      +-----------------------+      +-----------------------+
|   Tesseract.js OCR    |      |  jsQR / BarcodeDetector|     |  Browser Navigation   |
| (In-Browser Frame OCR)|      |  (Canvas Frame Scan)  |      |  (Voice Routing)      |
+-----------------------+      +-----------------------+      +-----------------------+
       │
       ▼
+-----------------------------------------------------------------------------------+
|                           EXPRESS BACKEND SERVER (/api)                            |
|  - POST /api/summarize                                                            |
|  - Server-Side Gemini 2.5 Flash Integration (Secure API Key proxy)               |
+-----------------------------------------------------------------------------------+
```

---

## 8. End-to-End Workflow

1. **Initialization & Speech Unlocking**:
   - Application boots and initializes `VoiceContext`.
   - Voice assistant greets the user aloud and activates the persistent `SpeechRecognition` loop.

2. **Command Navigation**:
   - User speaks *"Document Reader"*.
   - Global command router navigates to `/doc-reader`.
   - Application speaks initial instructions: *"Document Reader. Say 'scan document' to read a paper or card, or 'scan code' to look for a QR or barcode..."*

3. **Camera & Vision Activation**:
   - User speaks *"Scan Document"* or *"Scan Code"*.
   - System speaks pre-action notification (*"I need access to your camera..."*), then calls `getUserMedia()`.
   - Live camera preview displays on screen with visible status badges for sighted helpers.

4. **Document Capture & Processing**:
   - User says *"Capture"* (or holds steady for auto-capture).
   - Video frame is drawn to an offscreen canvas and processed via Tesseract.js.
   - Extracted text is read aloud via `SpeechSynthesis`.

5. **AI Summarization**:
   - System analyzes text heuristics for form/contract keywords (`terms`, `agreement`, `signature`, `conditions`).
   - If detected, extracted text is posted to `/api/summarize`.
   - Express server invokes Gemini 2.5 Flash to generate a 4-sentence summary, which is spoken aloud as *"Here's a summary..."*

6. **Code Scan Execution**:
   - User says *"Scan Code"*.
   - System continuously scans canvas frames with `jsQR` / `BarcodeDetector`.
   - When detected, system announces: *"I found a code. Say 'scan it' to open it, or 'ignore' to keep looking."*
   - On *"Scan it"*, system reads content or navigates safely to web link.

7. **Clean Exit**:
   - User says *"Home"* or *"Go Back"*.
   - Media tracks (`MediaStreamTrack.stop()`) cleanly release camera hardware before navigating back to root view.
