// src/app/utils/password.validator.ts
//
// Shared server-side password strength rules — mirrors web/mobile validators.

export interface PasswordRule {
  key: string;
  label: string;
  test: (p: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'One special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** Returns null if valid, or a human-readable error string. */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }

  const failed = PASSWORD_RULES.filter((r) => !r.test(password));
  if (failed.length === 0) return null;

  return `Password must include ${failed.map((r) => r.label.toLowerCase()).join(', ')}.`;
}
