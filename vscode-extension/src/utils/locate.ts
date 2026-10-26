import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Pure filesystem search for AVR tools — no vscode import, so it can be
// exercised outside the extension host.
//
// Students install avr-gcc in many different ways, so the search covers:
//   - the PATH VS Code was launched with
//   - Homebrew (Intel /usr/local and Apple Silicon /opt/homebrew), MacPorts
//   - apt / pacman (/usr/bin)
//   - Arduino IDE 2.x and 1.8 boards manager (Arduino15/packages/...)
//   - Arduino IDE 1.x bundled toolchain (hardware/tools/avr)
//   - Microchip / Atmel Studio, WinAVR, Scoop, Chocolatey, standalone
//     Microchip "avr8-gnu-toolchain" unpacked in a common place
//
// A GUI-launched VS Code on macOS often doesn't inherit the shell PATH, which
// is why the fixed locations are checked even though PATH comes first.

export type Tool = "avr-gcc" | "avr-objcopy" | "avrdude";

export interface LocateEnv {
  platform: NodeJS.Platform;
  pathVar: string;
  home: string;
  env: Record<string, string | undefined>;
}

export function currentEnv(): LocateEnv {
  return {
    platform: process.platform,
    pathVar: process.env["PATH"] ?? process.env["Path"] ?? "",
    home: os.homedir(),
    env: process.env,
  };
}

function exe(platform: NodeJS.Platform, name: string): string {
  return platform === "win32" ? `${name}.exe` : name;
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// Subdirectories of `dir`, newest version first (e.g. 7.3.0-atmel3.6.1-arduino7).
function versionDirs(dir: string): string[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; } })
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((n) => path.join(dir, n));
}

// Directories that may contain avr-gcc / avr-objcopy (a toolchain "bin").
function toolchainBinDirs(e: LocateEnv): string[] {
  const dirs: string[] = [];
  const arduino15 =
    e.platform === "win32" ? path.join(e.env["LOCALAPPDATA"] ?? path.join(e.home, "AppData", "Local"), "Arduino15")
    : e.platform === "darwin" ? path.join(e.home, "Library", "Arduino15")
    : path.join(e.home, ".arduino15");
  const arduinoGcc = versionDirs(path.join(arduino15, "packages", "arduino", "tools", "avr-gcc")).map((d) => path.join(d, "bin"));

  if (e.platform === "darwin") {
    dirs.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/opt/local/bin",
      ...versionDirs("/opt/homebrew/opt").filter((d) => /avr-gcc/.test(path.basename(d))).map((d) => path.join(d, "bin")),
      ...versionDirs("/usr/local/opt").filter((d) => /avr-gcc/.test(path.basename(d))).map((d) => path.join(d, "bin")),
      "/usr/local/CrossPack-AVR/bin",
      ...arduinoGcc,
      "/Applications/Arduino.app/Contents/Java/hardware/tools/avr/bin",
    );
  } else if (e.platform === "win32") {
    const pf = e.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = e.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    dirs.push(
      ...arduinoGcc,
      path.join(pf86, "Arduino", "hardware", "tools", "avr", "bin"),
      path.join(pf, "Arduino", "hardware", "tools", "avr", "bin"),
      path.join(pf86, "Atmel", "Studio", "7.0", "toolchain", "avr8", "avr8-gnu-toolchain", "bin"),
      path.join(pf86, "Microchip", "Studio", "7.0", "toolchain", "avr8", "avr8-gnu-toolchain", "bin"),
      "C:\\avr8-gnu-toolchain\\bin",
      "C:\\avr-gcc\\bin",
      ...versionDirs("C:\\").filter((d) => /^WinAVR/i.test(path.basename(d))).map((d) => path.join(d, "bin")),
      path.join(e.home, "scoop", "shims"),
      path.join(e.env["ChocolateyInstall"] ?? "C:\\ProgramData\\chocolatey", "bin"),
    );
  } else {
    dirs.push(
      "/usr/bin",
      "/usr/local/bin",
      "/opt/avr8-gnu-toolchain-linux_x86_64/bin",
      "/opt/avr-gcc/bin",
      ...arduinoGcc,
    );
  }
  return dirs;
}

// Directories that may contain avrdude.
function avrdudeDirs(e: LocateEnv, gccBinDir?: string): string[] {
  const arduino15 =
    e.platform === "win32" ? path.join(e.env["LOCALAPPDATA"] ?? path.join(e.home, "AppData", "Local"), "Arduino15")
    : e.platform === "darwin" ? path.join(e.home, "Library", "Arduino15")
    : path.join(e.home, ".arduino15");
  return [
    // Most installs (Homebrew, apt, WinAVR, Arduino 1.x) put avrdude next to avr-gcc.
    ...(gccBinDir ? [gccBinDir] : []),
    ...versionDirs(path.join(arduino15, "packages", "arduino", "tools", "avrdude")).map((d) => path.join(d, "bin")),
    ...toolchainBinDirs(e),
  ];
}

function pathDirs(e: LocateEnv): string[] {
  const sep = e.platform === "win32" ? ";" : ":";
  return e.pathVar.split(sep).filter(Boolean);
}

/** First existing `tool` in PATH, then in the known install locations. */
export function locate(tool: Tool, e: LocateEnv = currentEnv(), preferDir?: string): string | null {
  const name = exe(e.platform, tool);
  const dirs = tool === "avrdude"
    ? [...(preferDir ? [preferDir] : []), ...pathDirs(e), ...avrdudeDirs(e, preferDir)]
    : [...(preferDir ? [preferDir] : []), ...pathDirs(e), ...toolchainBinDirs(e)];
  for (const d of dirs) {
    const p = path.join(d, name);
    if (isFile(p)) { return p; }
  }
  return null;
}

/** avr-objcopy that belongs to the given avr-gcc (same bin dir), else anywhere. */
export function siblingTool(gccPath: string, tool: Tool, e: LocateEnv = currentEnv()): string | null {
  const dir = path.dirname(realpath(gccPath));
  const sibling = path.join(dir, exe(e.platform, tool));
  if (isFile(sibling)) { return sibling; }
  const linkDir = path.join(path.dirname(gccPath), exe(e.platform, tool));
  if (isFile(linkDir)) { return linkDir; }
  return locate(tool, e);
}

export function realpath(p: string): string {
  try { return fs.realpathSync(p); } catch { return p; }
}

/**
 * avr-libc headers for an avr-gcc binary. Follows symlinks first: Homebrew's
 * /usr/local/bin/avr-gcc points into ../Cellar/avr-gcc@N/<ver>/bin and the
 * headers live under that Cellar prefix. Returns null if none found.
 */
export function deriveInclude(gccPath: string): string | null {
  const prefix = path.dirname(path.dirname(realpath(gccPath)));
  const candidates = [
    path.join(prefix, "avr", "include"),          // Homebrew, Arduino, Microchip, WinAVR
    path.join(prefix, "lib", "avr", "include"),   // Debian/Ubuntu gcc-avr (/usr/lib/avr/include)
    path.resolve(prefix, "..", "avr", "include"),
  ];
  for (const c of candidates) {
    if (isFile(path.join(c, "avr", "io.h"))) { return c; }
  }
  return null;
}
