import { ApiError } from '@/lib/api/client';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Wrong phone or password.',
  AUTH_INVALID: 'Your session expired. Please log in again.',
  AUTH_REQUIRED: 'Please log in to continue.',
  PHONE_TAKEN: 'That phone number is already registered. Try logging in.',
  USERNAME_TAKEN: 'That username is taken. Pick another.',
  INVALID_REFERRAL_CODE: 'That referral code is not valid.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact support.',
  ACCOUNT_BANNED: 'This account is banned.',
  VALIDATION: 'Please check your details and try again.',
  INSUFFICIENT_FUNDS: 'Insufficient balance for this amount.',
  INVALID_AMOUNT: 'Enter a valid amount.',
  BELOW_MIN: 'Amount is below the minimum.',
  INVALID_PHONE: 'Enter a valid Kenyan phone number.',
};

/** Map any thrown error to a friendly, action-oriented message. */
export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message ?? 'Something went wrong.';
  return 'Network error. Please check your connection and try again.';
}
