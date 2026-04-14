import type { Keypoint } from "@/types";

// YOLOv8n-Pose output tensor shape: [1, 56, 8400]
// Each of the 8400 predictions: [x_c, y_c, w, h, conf, kp0_x, kp0_y, kp0_v, ..., kp16_x, kp16_y, kp16_v]
// After transposing to [8400, 56].

const MODEL_INPUT_SIZE = 640;
const NUM_KEYPOINTS = 17;
const CONFIDENCE_THRESHOLD = 0.5;
const IOU_THRESHOLD = 0.45;
const MIN_VISIBILITY = 0.3;

export interface Detection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] normalized 0..1
  confidence: number;
  keypoints: Keypoint[];
}

// Preprocess: ImageData → Float32Array in CHW NCHW format [1, 3, 640, 640]
// Values normalized to [0, 1].
export function preprocessImageData(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  // data is RGBA interleaved: [R,G,B,A, R,G,B,A, ...]
  const tensor = new Float32Array(3 * width * height);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    tensor[i]                  = data[i * 4]     / 255; // R channel
    tensor[i + pixelCount]     = data[i * 4 + 1] / 255; // G channel
    tensor[i + pixelCount * 2] = data[i * 4 + 2] / 255; // B channel
  }

  return tensor;
}

// Post-process the raw model output tensor data.
// outputData: Float32Array from tensor of shape [1, 56, 8400] flattened.
// Returns the best detection (highest confidence after NMS), or null.
export function postprocessOutput(
  outputData: Float32Array,
  originalWidth: number,
  originalHeight: number
): Detection | null {
  // The raw output from YOLOv8 pose is [1, 56, 8400].
  // We need to transpose it to [8400, 56].
  const numPredictions = 8400;
  const predictionSize = 56; // 4 bbox + 1 conf + 17*3 kps

  const detections: Detection[] = [];

  for (let i = 0; i < numPredictions; i++) {
    // Confidence is at index [4] in the prediction
    // In [1, 56, 8400] layout flattened: outputData[4 * 8400 + i]
    const conf = outputData[4 * numPredictions + i];
    if (conf < CONFIDENCE_THRESHOLD) continue;

    // Bounding box center + dimensions (normalized to model input size)
    const xc = outputData[0 * numPredictions + i] / MODEL_INPUT_SIZE;
    const yc = outputData[1 * numPredictions + i] / MODEL_INPUT_SIZE;
    const w  = outputData[2 * numPredictions + i] / MODEL_INPUT_SIZE;
    const h  = outputData[3 * numPredictions + i] / MODEL_INPUT_SIZE;

    const x1 = xc - w / 2;
    const y1 = yc - h / 2;
    const x2 = xc + w / 2;
    const y2 = yc + h / 2;

    // Extract 17 keypoints
    const keypoints: Keypoint[] = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const baseIdx = (5 + k * 3) * numPredictions + i;
      const kx = (outputData[baseIdx]     / MODEL_INPUT_SIZE) * originalWidth;
      const ky = (outputData[baseIdx + 1] / MODEL_INPUT_SIZE) * originalHeight;
      const kv = outputData[baseIdx + 2];

      keypoints.push({
        x: kx,
        y: ky,
        visibility: kv,
      });
    }

    detections.push({
      bbox: [x1 * originalWidth, y1 * originalHeight, x2 * originalWidth, y2 * originalHeight],
      confidence: conf,
      keypoints,
    });
  }

  if (detections.length === 0) return null;

  // Apply simple NMS and return best detection
  const nmsResults = nonMaxSuppression(detections, IOU_THRESHOLD);
  if (nmsResults.length === 0) return null;

  // Return the detection with the highest confidence
  return nmsResults.reduce((best, det) =>
    det.confidence > best.confidence ? det : best
  );
}

// Simple greedy NMS implementation
function nonMaxSuppression(
  detections: Detection[],
  iouThreshold: number
): Detection[] {
  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];

  for (const det of sorted) {
    let suppressed = false;
    for (const keptDet of kept) {
      if (computeIoU(det.bbox, keptDet.bbox) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(det);
  }

  return kept;
}

function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interX1 = Math.max(a[0], b[0]);
  const interY1 = Math.max(a[1], b[1]);
  const interX2 = Math.min(a[2], b[2]);
  const interY2 = Math.min(a[3], b[3]);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  if (interArea === 0) return 0;

  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);

  return interArea / (aArea + bArea - interArea);
}

// Convert a Detection to an array of Keypoints with visibility filtering.
// Keypoints below MIN_VISIBILITY are set to {x:0, y:0, visibility:0}.
export function filterKeypoints(keypoints: Keypoint[]): Keypoint[] {
  return keypoints.map((kp) =>
    kp.visibility >= MIN_VISIBILITY ? kp : { x: 0, y: 0, visibility: 0 }
  );
}
