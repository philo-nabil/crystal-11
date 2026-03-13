import * as path from "path";

/**
 * isSafePath — prevents path traversal attacks.
 * Returns true only if userInput resolves to rootDir itself or a subdirectory.
 *
 * NOTE: path.resolve() does not dereference symlinks (e.g. /var → /private/var on macOS).
 * If symlink traversal is a concern, use fs.realpathSync on both paths before comparing.
 */
export function isSafePath(userInput: string, rootDir: string): boolean {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(rootDir, userInput);
  // Allow exact match (rootDir itself) OR a proper subdirectory.
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * isValidLabel — for short display-safe labels (names, identifiers, tags).
 * Allows: alphanumeric, underscore, hyphen, dot, space. Max 256 chars.
 * NOT suitable for paths (no '/'), URLs (no ':', '@'), or free-form text.
 */
export function isValidLabel(input: string): boolean {
  // !input catches null/undefined/"". trim().length === 0 catches all-whitespace.
  if (!input || input.trim().length === 0 || input.length > 256) { return false; }
  return /^[\w\-. ]+$/.test(input);
}

/**
 * isSafeFileName — validates a filename for use when saving generated files.
 * 1 alphanumeric start + up to 127 further chars = 128 max.
 * No leading/trailing spaces, no path traversal sequences.
 */
export function isSafeFileName(name: string): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9_\-. ]{0,127}$/.test(name) &&
    !name.includes("..") &&
    name.trim() === name
  );
}
