import { Global, Module } from '@nestjs/common';
import { InMemoryJobQueue, JobQueue } from './job-queue';

@Global()
@Module({
  providers: [{ provide: JobQueue, useClass: InMemoryJobQueue }],
  exports: [JobQueue],
})
export class JobsModule {}
