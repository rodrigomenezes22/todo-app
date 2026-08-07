/** Shared validation for the user reference stored on an assigned task. */

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const USERNAME_PATTERN = /^[a-z0-9._-]{1,40}$/;

export function sanitizeUserId(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  const value = input.trim().toLowerCase();
  return OBJECT_ID_PATTERN.test(value) ? value : "";
}

export function sanitizeUsername(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  const value = input.trim().toLowerCase();
  return USERNAME_PATTERN.test(value) ? value : "";
}
