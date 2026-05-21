import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface UseImageLandmarkerReturn {
  status: Status;
  error: string | null;
  detect: (image: HTMLImageElement) => FaceLandmarkerResult | null;
}

/**
 * Same face landmarker as the live one, but in IMAGE mode for one-shot
 * processing of still images (calibration / reference extraction).
 */
export function useImageLandmarker(): UseImageLandmarkerReturn {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<FaceLandmarker | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        const lm = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'IMAGE',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (cancelled) {
          lm.close();
          return;
        }
        ref.current = lm;
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'Failed to load model');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      ref.current?.close();
      ref.current = null;
    };
  }, []);

  const detect = useCallback((image: HTMLImageElement) => {
    const lm = ref.current;
    if (!lm) return null;
    try {
      return lm.detect(image);
    } catch {
      return null;
    }
  }, []);

  return { status, error, detect };
}
