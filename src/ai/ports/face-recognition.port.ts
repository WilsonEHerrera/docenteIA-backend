export interface FaceRef {
  studentId: string;
  /** Facial representation of the student (never the photo). */
  embedding: number[];
}

export interface FaceRecognitionInput {
  /** Group photo, processed in memory and never persisted. */
  image: Buffer;
  /** Only students with a valid biometric consent. */
  candidates: FaceRef[];
}

export interface FaceRecognitionResult {
  matches: { studentId: string; confidence: number }[];
  /** Faces detected in the photo that matched nobody. */
  unrecognizedFaces: number;
}

export interface FaceEnrollmentResult {
  /** Facial representation to store (encrypted); the photo is discarded. */
  embedding: number[];
}

/** Contract for any face recognition provider (and its Fake). */
export abstract class FaceRecognitionPort {
  abstract readonly provider: string;

  /** Builds the reference representation of one student from a single-face photo. */
  abstract enroll(input: { image: Buffer }): Promise<FaceEnrollmentResult>;

  abstract recognize(
    input: FaceRecognitionInput,
  ): Promise<FaceRecognitionResult>;
}
