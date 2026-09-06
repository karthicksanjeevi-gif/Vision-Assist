import jsQR from 'jsqr';

export interface CodeDetectionResult {
  type: 'QR' | 'BARCODE';
  data: string;
}

/**
 * Scans a canvas contextImageData for QR codes (using jsQR) and barcodes (using BarcodeDetector API if available)
 */
export async function detectCodeFromCanvas(
  canvas: HTMLCanvasElement
): Promise<CodeDetectionResult | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) return null;

  // 1. Try Native BarcodeDetector API if available (covers QR + UPC, EAN, Code128, etc.)
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const barcodeDetector = new (window as any).BarcodeDetector();
      const detected = await barcodeDetector.detect(canvas);
      if (detected && detected.length > 0) {
        const item = detected[0];
        return {
          type: item.format === 'qr_code' ? 'QR' : 'BARCODE',
          data: item.rawValue || item.data || '',
        };
      }
    } catch (e) {
      // Fallback to jsQR
    }
  }

  // 2. jsQR fallback for QR code detection
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (qrResult && qrResult.data) {
      return {
        type: 'QR',
        data: qrResult.data,
      };
    }
  } catch (e) {
    // Ignore frame read error
  }

  return null;
}

/**
 * Heuristic to check if text resembles a form, contract, agreement, application, or legal document.
 * Logs matched keywords and criteria for debugging.
 */
export function isFormOrAgreement(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const normalized = text.toLowerCase();

  const keywords = [
    'terms',
    'agreement',
    'eligibility',
    'signature',
    'conditions',
    'contract',
    'application',
    'policy',
    'clause',
    'liability',
    'rights',
    'notice',
    'disclosure',
    'warrant',
    'consent',
    'agree',
    'sign',
    'applicant',
    'date',
    'form',
    'waiver',
    'privacy',
    'service',
    'fee',
    'rules',
    'lease',
    'section',
    'plan',
    'permit',
    'invoice',
    'receipt',
    'statement',
    'authorization',
    'requirement',
    'signed',
    'party',
    'tenant',
    'landlord',
    'employer',
    'employee',
    'client',
    'customer',
  ];

  const matchedKeywords: string[] = [];
  for (const kw of keywords) {
    if (normalized.includes(kw)) {
      matchedKeywords.push(kw);
    }
  }

  // Check for key-value form field colons (e.g. Name:, Date:, Signature:, Address:)
  const formFieldPattern = /(name|date|signature|address|phone|email|ssn|dob|sign|title)\s*:/i;
  const hasFormField = formFieldPattern.test(normalized);
  if (hasFormField) {
    matchedKeywords.push('form-field-colon');
  }

  // A document is considered a form/agreement if keywords/form fields match or if it is substantial text
  const isMatch = matchedKeywords.length >= 1 || text.length >= 60;

  console.log('[isFormOrAgreement Heuristic Result]:', {
    textLength: text.length,
    matchCount: matchedKeywords.length,
    matchedKeywords,
    isMatch,
  });

  return isMatch;
}
