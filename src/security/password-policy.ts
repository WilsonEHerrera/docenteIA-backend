const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'contrasena',
  'contrasena1',
  'contrasena123',
  'iloveyou123',
  'admin12345',
  'administrador',
  'docentia123',
]);

/** Returns a Spanish reason when the password is not acceptable, else null. */
export function passwordPolicyViolation(
  password: string,
  email?: string,
): string | null {
  if (password.length < MIN_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`;
  }
  if (password.length > MAX_LENGTH) {
    return `La contraseña no puede superar ${MAX_LENGTH} caracteres.`;
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    return 'La contraseña es demasiado común.';
  }
  if (/^(.)\1+$/.test(password)) {
    return 'La contraseña no puede repetir un solo carácter.';
  }
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lowered.includes(localPart)) {
    return 'La contraseña no puede contener tu correo.';
  }
  return null;
}
