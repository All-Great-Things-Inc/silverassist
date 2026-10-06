// Server configuration only: exact addresses, never domains or wildcards.
export function emailAllowed(email: unknown, configured: unknown): boolean {
  if (typeof email !== 'string' || typeof configured !== 'string') return false
  const entries = configured.split(',').map(value => value.trim().toLowerCase())
  // A missing, empty or malformed list denies access rather than opening signup.
  if (!entries.length || entries.some(value => !/^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(value))) return false
  return entries.includes(email.trim().toLowerCase())
}

export const accessDeniedMessage = 'This email address is not approved for access. Contact the portal owner.'
