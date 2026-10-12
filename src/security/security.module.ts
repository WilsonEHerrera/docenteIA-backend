import { Global, Module } from '@nestjs/common';
import { FieldCipher } from './field-cipher';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [PasswordService, TokenService, FieldCipher],
  exports: [PasswordService, TokenService, FieldCipher],
})
export class SecurityModule {}
