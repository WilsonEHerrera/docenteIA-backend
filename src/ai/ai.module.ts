import { Module } from '@nestjs/common';
import { FakeFaceRecognition } from './adapters/fake-face-recognition';
import { FakeQuizGeneration } from './adapters/fake-quiz-generation';
import { FakeTextEvaluation } from './adapters/fake-text-evaluation';
import { AiRunner } from './ai-runner.service';
import { FaceRecognitionPort } from './ports/face-recognition.port';
import { QuizGenerationPort } from './ports/quiz-generation.port';
import { TextEvaluationPort } from './ports/text-evaluation.port';

// AI_PROVIDER only accepts "fake" today. When a real adapter exists, bind each
// port here with a factory that switches on AppConfig.values.AI_PROVIDER.
@Module({
  providers: [
    AiRunner,
    { provide: FaceRecognitionPort, useClass: FakeFaceRecognition },
    { provide: TextEvaluationPort, useClass: FakeTextEvaluation },
    { provide: QuizGenerationPort, useClass: FakeQuizGeneration },
  ],
  exports: [
    AiRunner,
    FaceRecognitionPort,
    TextEvaluationPort,
    QuizGenerationPort,
  ],
})
export class AiModule {}
