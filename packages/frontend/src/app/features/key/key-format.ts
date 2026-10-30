/** A key is the base64 of exactly 32 bytes: 43 characters and one `=`. */
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

/** Whether `value` (surrounding whitespace ignored) is a well-formed key. */
export function isKeyFormat(value: string): boolean {
  return KEY_PATTERN.test(value.trim());
}
