import * as cocoSsd from '@tensorflow-models/coco-ssd';

export interface DetectedHazard {
  id: string;
  label: string;
  category: 'drop_off' | 'overhead' | 'moving' | 'ground' | 'indoor_element' | 'wayfinding';
  tier: 1 | 2 | 3;
  distanceMeters: number;
  confidence: number;
  clockPosition: string;
  directionText: string;
  pan: number;
  warningPhrase: string;
  box: { x: number; y: number; width: number; height: number };
}

const OBJECT_DIMENSIONS_METERS: Record<string, { dimension: number; axis: 'width' | 'height' }> = {
  person: { dimension: 1.7, axis: 'height' },
  bicycle: { dimension: 1.5, axis: 'height' },
  car: { dimension: 1.8, axis: 'width' },
  motorcycle: { dimension: 1.1, axis: 'height' },
  airplane: { dimension: 3.5, axis: 'width' },
  bus: { dimension: 2.5, axis: 'width' },
  train: { dimension: 3, axis: 'width' },
  truck: { dimension: 2.5, axis: 'width' },
  boat: { dimension: 2, axis: 'width' },
  'traffic light': { dimension: 0.7, axis: 'height' },
  'fire hydrant': { dimension: 0.7, axis: 'height' },
  'stop sign': { dimension: 0.75, axis: 'height' },
  'parking meter': { dimension: 0.4, axis: 'width' },
  bench: { dimension: 1.2, axis: 'width' },
  bird: { dimension: 0.3, axis: 'width' },
  cat: { dimension: 0.3, axis: 'height' },
  dog: { dimension: 0.5, axis: 'height' },
  horse: { dimension: 1.5, axis: 'height' },
  sheep: { dimension: 0.9, axis: 'height' },
  cow: { dimension: 1.5, axis: 'height' },
  elephant: { dimension: 2.5, axis: 'height' },
  bear: { dimension: 1.5, axis: 'height' },
  zebra: { dimension: 1.5, axis: 'height' },
  giraffe: { dimension: 4, axis: 'height' },
  backpack: { dimension: 0.45, axis: 'height' },
  umbrella: { dimension: 0.9, axis: 'height' },
  handbag: { dimension: 0.35, axis: 'width' },
  tie: { dimension: 0.5, axis: 'height' },
  suitcase: { dimension: 0.6, axis: 'height' },
  frisbee: { dimension: 0.27, axis: 'width' },
  skis: { dimension: 1.7, axis: 'height' },
  snowboard: { dimension: 1.5, axis: 'height' },
  'sports ball': { dimension: 0.22, axis: 'width' },
  kite: { dimension: 0.8, axis: 'width' },
  'baseball bat': { dimension: 0.85, axis: 'height' },
  'baseball glove': { dimension: 0.3, axis: 'width' },
  skateboard: { dimension: 0.8, axis: 'width' },
  surfboard: { dimension: 1.8, axis: 'height' },
  'tennis racket': { dimension: 0.7, axis: 'height' },
  bottle: { dimension: 0.25, axis: 'height' },
  'wine glass': { dimension: 0.2, axis: 'height' },
  cup: { dimension: 0.1, axis: 'height' },
  fork: { dimension: 0.18, axis: 'height' },
  knife: { dimension: 0.2, axis: 'height' },
  spoon: { dimension: 0.17, axis: 'height' },
  bowl: { dimension: 0.18, axis: 'width' },
  banana: { dimension: 0.2, axis: 'width' },
  apple: { dimension: 0.08, axis: 'width' },
  sandwich: { dimension: 0.12, axis: 'width' },
  orange: { dimension: 0.08, axis: 'width' },
  broccoli: { dimension: 0.2, axis: 'height' },
  carrot: { dimension: 0.2, axis: 'height' },
  'hot dog': { dimension: 0.18, axis: 'width' },
  pizza: { dimension: 0.3, axis: 'width' },
  donut: { dimension: 0.1, axis: 'width' },
  cake: { dimension: 0.2, axis: 'height' },
  chair: { dimension: 0.5, axis: 'width' },
  couch: { dimension: 1.8, axis: 'width' },
  'potted plant': { dimension: 0.6, axis: 'height' },
  bed: { dimension: 1.5, axis: 'width' },
  'dining table': { dimension: 1.2, axis: 'width' },
  toilet: { dimension: 0.5, axis: 'width' },
  tv: { dimension: 0.9, axis: 'width' },
  laptop: { dimension: 0.35, axis: 'width' },
  mouse: { dimension: 0.06, axis: 'width' },
  remote: { dimension: 0.18, axis: 'height' },
  keyboard: { dimension: 0.4, axis: 'width' },
  'cell phone': { dimension: 0.08, axis: 'width' },
  microwave: { dimension: 0.5, axis: 'width' },
  oven: { dimension: 0.6, axis: 'width' },
  toaster: { dimension: 0.25, axis: 'width' },
  sink: { dimension: 0.55, axis: 'width' },
  refrigerator: { dimension: 1.7, axis: 'height' },
  book: { dimension: 0.22, axis: 'height' },
  clock: { dimension: 0.25, axis: 'width' },
  vase: { dimension: 0.3, axis: 'height' },
  scissors: { dimension: 0.18, axis: 'height' },
  'teddy bear': { dimension: 0.35, axis: 'height' },
  'hair drier': { dimension: 0.2, axis: 'width' },
  toothbrush: { dimension: 0.18, axis: 'height' },
};

function directionFor(centerX: number): { clock: string; text: string; pan: number } {
  const offset = centerX - 0.5;
  if (offset < -0.2) return { clock: "10 o'clock", text: 'to your left', pan: -0.7 };
  if (offset < -0.07) return { clock: "11 o'clock", text: 'slightly to your left', pan: -0.35 };
  if (offset > 0.2) return { clock: "2 o'clock", text: 'to your right', pan: 0.7 };
  if (offset > 0.07) return { clock: "1 o'clock", text: 'slightly to your right', pan: 0.35 };
  return { clock: "12 o'clock", text: 'straight ahead', pan: 0 };
}

function estimateDistanceMeters(
  className: string,
  bbox: [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
): number {
  const dimensions = OBJECT_DIMENSIONS_METERS[className];
  if (!dimensions) {
    const normalizedHeight = bbox[3] / frameHeight;
    if (normalizedHeight >= 0.7) return 0.8;
    if (normalizedHeight >= 0.4) return 1.8;
    if (normalizedHeight >= 0.2) return 3.5;
    return 6;
  }
  const horizontalFov = (70 * Math.PI) / 180;
  const verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) * (frameHeight / frameWidth));
  const imageDimension = dimensions.axis === 'width' ? bbox[2] : bbox[3];
  const frameDimension = dimensions.axis === 'width' ? frameWidth : frameHeight;
  const focalPixels =
    frameDimension / (2 * Math.tan((dimensions.axis === 'width' ? horizontalFov : verticalFov) / 2));

  if (imageDimension <= 0) return 8;
  return Math.max(0.5, Math.min(8, (dimensions.dimension * focalPixels) / imageDimension));
}

function hazardCategory(className: string): DetectedHazard['category'] {
  if (className === 'person' || ['bicycle', 'car', 'motorcycle', 'bus', 'truck'].includes(className)) {
    return 'moving';
  }
  if (['traffic light', 'stop sign', 'parking meter'].includes(className)) return 'wayfinding';
  if (['chair', 'couch', 'bed', 'dining table', 'toilet'].includes(className)) return 'indoor_element';
  return 'ground';
}

export function detectionsToHazards(
  detections: cocoSsd.DetectedObject[],
  frameWidth: number,
  frameHeight: number,
): DetectedHazard[] {
  return detections
    .map((detection, index) => {
      const [x, y, width, height] = detection.bbox;
      const centerX = (x + width / 2) / frameWidth;
      const distanceMeters = estimateDistanceMeters(detection.class, detection.bbox, frameWidth, frameHeight);
      const direction = directionFor(centerX);
      const isInWalkingPath = centerX >= 0.3 && centerX <= 0.7;
      const tier: DetectedHazard['tier'] =
        distanceMeters <= 1.5 && isInWalkingPath ? 1 : distanceMeters <= 4 ? 2 : 3;
      const label = detection.class.replace(/\b\w/g, (letter) => letter.toUpperCase());

      return {
        id: `${detection.class}-${index}`,
        label,
        category: hazardCategory(detection.class),
        tier,
        distanceMeters: Number(distanceMeters.toFixed(1)),
        confidence: detection.score,
        clockPosition: direction.clock,
        directionText: direction.text,
        pan: direction.pan,
        warningPhrase: `${label} ${direction.text}, estimated about ${distanceMeters.toFixed(1)} meters away.`,
        box: {
          x: Math.max(0, x / frameWidth),
          y: Math.max(0, y / frameHeight),
          width: Math.min(1, width / frameWidth),
          height: Math.min(1, height / frameHeight),
        },
      };
    })
    .sort((left, right) => left.tier - right.tier || left.distanceMeters - right.distanceMeters);
}
