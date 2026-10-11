import { parseEnv } from './env.schema';

describe('parseEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://a',
    DIRECT_URL: 'postgres://b',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults and parses the CORS list', () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: 'http://a.com, http://b.com',
    });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TTL_SECONDS).toBe(900);
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('fails with a readable message when a variable is missing', () => {
    expect(() =>
      parseEnv({
        DIRECT_URL: 'postgres://b',
        JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
