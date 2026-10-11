import { Global, Module } from '@nestjs/common';
import { Env, parseEnv } from './env.schema';

export abstract class AppConfig {
  abstract readonly values: Env;
}

class EnvAppConfig extends AppConfig {
  readonly values: Env = parseEnv(process.env);
}

/** Global typed config. Fails at boot when a variable is missing or invalid. */
@Global()
@Module({
  providers: [{ provide: AppConfig, useClass: EnvAppConfig }],
  exports: [AppConfig],
})
export class AppConfigModule {}
