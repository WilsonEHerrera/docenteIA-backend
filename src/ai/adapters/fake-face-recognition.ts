import { Injectable } from '@nestjs/common';
import {
  FaceEnrollmentResult,
  FaceRecognitionInput,
  FaceRecognitionPort,
  FaceRecognitionResult,
} from '../ports/face-recognition.port';
import { hashInt } from './fake-hash';

interface Scenario {
  /** Simulates the provider being down. */
  down?: boolean;
  /** Number of students whose face is hidden: they produce no match. */
  covered?: number;
  /** Number of students matched with low confidence (below the threshold). */
  lowConfidence?: number;
}

const MARKER = 'FAKE:';
const MAX_HEADER_BYTES = 512;

/** A test photo may start with `FAKE:{"covered":2}\n` to script the outcome. */
function readScenario(image: Buffer): Scenario {
  const head = image.subarray(0, MAX_HEADER_BYTES).toString('utf8');
  if (!head.startsWith(MARKER)) return {};
  const end = head.indexOf('\n');
  if (end === -1) return {};
  try {
    const parsed: unknown = JSON.parse(head.slice(MARKER.length, end));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const raw = parsed as Record<string, unknown>;
    const count = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
    return {
      down: raw.down === true,
      covered: count(raw.covered),
      lowConfidence: count(raw.lowConfidence),
    };
  } catch {
    return {};
  }
}

/**
 * Deterministic stand-in for a face recognition provider: it never looks at
 * pixels. By default every candidate is recognized with 0.90–0.99 confidence.
 */
@Injectable()
export class FakeFaceRecognition extends FaceRecognitionPort {
  readonly provider = 'fake';

  enroll(input: { image: Buffer }): Promise<FaceEnrollmentResult> {
    const { image } = input;
    if (image.length === 0) {
      return Promise.reject(new Error('FakeFaceRecognition: empty image'));
    }
    if (readScenario(image).down) {
      return Promise.reject(
        new Error('FakeFaceRecognition: simulated provider outage'),
      );
    }
    // 16 stable numbers in [0, 1): same photo → same "embedding".
    const embedding = Array.from(
      { length: 16 },
      (_, i) => hashInt(image, `dim-${i}`) / 2 ** 32,
    );
    return Promise.resolve({ embedding });
  }

  recognize(input: FaceRecognitionInput): Promise<FaceRecognitionResult> {
    const { image, candidates } = input;
    if (image.length === 0) {
      return Promise.reject(new Error('FakeFaceRecognition: empty image'));
    }
    const scenario = readScenario(image);
    if (scenario.down) {
      return Promise.reject(
        new Error('FakeFaceRecognition: simulated provider outage'),
      );
    }

    // Stable per-image order decides who is "covered" or "blurry".
    const ordered = [...candidates].sort(
      (a, b) =>
        hashInt(image, a.studentId) - hashInt(image, b.studentId) ||
        a.studentId.localeCompare(b.studentId),
    );
    const covered = Math.min(scenario.covered ?? 0, ordered.length);
    const lowConfidence = Math.min(
      scenario.lowConfidence ?? 0,
      ordered.length - covered,
    );

    const matches = ordered.slice(covered).map((candidate, index) => {
      const seed = hashInt(image, candidate.studentId, 'confidence');
      const confidence =
        index < lowConfidence
          ? 0.5 + (seed % 20) / 100 // 0.50–0.69
          : 0.9 + (seed % 10) / 100; // 0.90–0.99
      return { studentId: candidate.studentId, confidence };
    });

    return Promise.resolve({
      matches,
      unrecognizedFaces: covered,
    });
  }
}
