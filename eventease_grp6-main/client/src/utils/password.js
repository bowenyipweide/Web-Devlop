// Mirrors the server-side password policy in
// server/src/controllers/auth.controller.js: at least 8 characters, with an
// uppercase letter and a symbol. Returns an i18n key describing the first
// problem, or null when the password is acceptable.

export const PASSWORD_MIN_LENGTH = 8;

export function passwordPolicyKey(password) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) return 'auth.passwordTooShort';
  if (!/[A-Z]/.test(value)) return 'auth.passwordNeedsUppercase';
  if (!/[^A-Za-z0-9]/.test(value)) return 'auth.passwordNeedsSymbol';
  return null;
}

// For the HTML pattern attribute: only non-empty values are constrained, so an
// untouched optional field is not blocked.
export const PASSWORD_PATTERN = `^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{${PASSWORD_MIN_LENGTH},}$`;
