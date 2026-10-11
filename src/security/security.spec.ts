import { Role } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { parseEnv } from '../config/env.schema';
import { passwordPolicyViolation } from './password-policy';
import { TokenService } from './token.service';

const config = {
  values: parseEnv({
    DATABASE_URL: 'x',
    DIRECT_URL: 'x',
    JWT_ACCESS_SECRET: 's'.repeat(40),
    ACCESS_TTL_SECONDS: '60',
  }),
} as AppConfig;

describe('TokenService', () => {
  const tokens = new TokenService(config);
  const user = { id: 'u1', institutionId: 'i1', role: Role.TEACHER };

  it('round-trips a signed token', () => {
    const { token } = tokens.signAccess(user);
    expect(tokens.verifyAccess(token)).toEqual(user);
  });

  it('rejects a tampered payload', () => {
    const { token } = tokens.signAccess(user);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u1', inst: 'i1', role: 'ADMIN', exp: 9999999999 }),
    ).toString('base64url');
    expect(tokens.verifyAccess(`${h}.${forged}.${s}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = tokens.signAccess(user, new Date('2020-01-01'));
    expect(tokens.verifyAccess(token)).toBeNull();
  });

  it('rejects alg=none style tokens and garbage', () => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
      'base64url',
    );
    const body = Buffer.from(
      JSON.stringify({ sub: 'u1', inst: 'i1', role: 'ADMIN', exp: 9999999999 }),
    ).toString('base64url');
    expect(tokens.verifyAccess(`${header}.${body}.`)).toBeNull();
    expect(tokens.verifyAccess('nonsense')).toBeNull();
  });
});

describe('passwordPolicyViolation', () => {
  it('accepts a strong password', () => {
    expect(
      passwordPolicyViolation('Correcta#Larga2026', 'ana@x.com'),
    ).toBeNull();
  });

  it.each([
    ['short', 'corta'],
    ['common', 'password123'],
    ['repeated', 'aaaaaaaaaaaa'],
    ['contains email', 'anaperez-2026!'],
  ])('rejects %s', (_label, password) => {
    expect(passwordPolicyViolation(password, 'anaperez@x.com')).not.toBeNull();
  });
});
