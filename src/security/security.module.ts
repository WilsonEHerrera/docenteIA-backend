import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [PasswordService, TokenService],
  exports: [PasswordService, TokenService],
})
export class SecurityModule {}
