export const passwordRules = [
  { label: 'At least 8 characters', check: (value: string) => value.length >= 8 },
  { label: 'An uppercase letter', check: (value: string) => /[A-Z]/.test(value) },
  { label: 'A lowercase letter', check: (value: string) => /[a-z]/.test(value) },
  { label: 'A number', check: (value: string) => /[0-9]/.test(value) },
  { label: 'A symbol', check: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
]

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && passwordRules.every(rule => rule.check(value))
}

export const passwordPolicyMessage = 'Use 8–128 characters with uppercase, lowercase, a number, and a symbol.'
