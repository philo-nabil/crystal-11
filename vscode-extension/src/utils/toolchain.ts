import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ── Known install locations per platform ─────────────────────────────────────

const CANDIDATE_PATHS: Record<NodeJS.Platform, string[]> = {
  darwin: [
    "/usr/local/bin/avr-gcc",             // Homebrew x86_64 (Intel Mac)
    "/opt/homebrew/bin/avr-gcc",          // Homebrew arm64 (M1/M2/M3/M4)
    "/opt/local/bin/avr-gcc",             // MacPorts
  ],
  linux: [
    "/usr/bin/avr-gcc",                   // apt (Ubuntu/Debian)
    "/usr/local/bin/avr-gcc",
  ],
  win32: [
    "C:\\WinAVR-20100110\\bin\\avr-gcc.exe",
    "C:\\avr-gcc\\bin\\avr-gcc.exe",
    // Scoop installs to user home — resolved dynamically below
  ],
  // fill in required index signature for remaining platforms
  aix: [], android: [], cygwin: [], freebsd: [], haiku: [],
  netbsd: [], openbsd: [], sunos: [], /* 'linux' covers most POSIX */ 
} as Record<NodeJS.Platform, string[]>;

// ── Public API ────────────────────────────────────────────────────────────────

export interface ToolchainInfo {
  /** Absolute path to the avr-gcc binary */
  gccPath: string;
  /** Derived avr include dir: <prefix>/avr/include or <prefix>/../avr/include */
  includePath: string;
  /** Source: how we found it */
  source: "setting" | "autodetect";
}

/**
 * Resolve avr-gcc: check the user setting first, then auto-detect.
 * Returns null if nothing found.
 */
export async function resolveToolchain(): Promise<ToolchainInfo | null> {
  // 1. Settings override
  const cfg = vscode.workspace.getConfiguration("crystal11");
  const settingPath = cfg.get<string>("avrGccPath", "").trim();
  if (settingPath) {
    if (fs.existsSync(settingPath)) {
      return { gccPath: settingPath, includePath: deriveInclude(settingPath), source: "setting" };
    }
    // User configured something but it doesn't exist — warn and fall through
    vscode.window.showWarningMessage(
      `crystal-11: crystal11.avrGccPath is set to "${settingPath}" but that file doesn't exist. Falling back to auto-detect.`
    );
  }

  // 2. Auto-detect from known locations
  const platform = process.platform as NodeJS.Platform;
  const candidates = [...(CANDIDATE_PATHS[platform] ?? [])];

  // On Windows also check Scoop's per-user path
  if (platform === "win32") {
    const home = process.env["USERPROFILE"] ?? "";
    if (home) {
      candidates.push(path.join(home, "scoop", "shims", "avr-gcc.exe"));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { gccPath: candidate, includePath: deriveInclude(candidate), source: "autodetect" };
    }
  }

  return null;
}

/**
 * Derive the avr/include path from the gcc binary path.
 * avr-gcc lives in <prefix>/bin/avr-gcc.
 * avr-libc headers live in <prefix>/avr/include  (Homebrew, apt)
 * or <prefix>/../avr/include on some setups.
 */
function deriveInclude(gccPath: string): string {
  const binDir  = path.dirname(gccPath);          // .../bin
  const prefix  = path.dirname(binDir);            // ...
  const primary = path.join(prefix, "avr", "include");
  if (fs.existsSync(primary)) { return primary; }
  // Homebrew on some versions nests it differently
  const alt = path.join(prefix, "..", "avr", "include");
  return path.resolve(alt);
}

// ── Install guidance ──────────────────────────────────────────────────────────

export interface InstallGuide {
  platform: string;
  command: string;
  url: string;
  note: string;
}

export function getInstallGuide(): InstallGuide {
  switch (process.platform) {
    case "darwin":
      return {
        platform: "macOS",
        command: "brew tap osx-cross/avr && brew install avr-gcc",
        url: "https://github.com/osx-cross/homebrew-avr",
        note: [
          "⚠️  WARNING: This will compile GCC from source and takes 20–30 minutes with very high CPU usage. Your fans will spin up — this is normal, not a virus.",
          "",
          "To avoid this, try one of these faster options first:",
          "",
          "Option 1 — Update Xcode (recommended):",
          "  Update Xcode to the latest version from the App Store, then re-run the brew command above. A pre-compiled bottle will be downloaded in seconds instead.",
          "",
          "Option 2 — CrossPack (pre-built, no compile needed):",
          "  Download from https://www.obdev.at/products/crosspack/index.html",
          "  Installs avr-gcc instantly as a pre-built package.",
          "",
          "Option 3 — Arduino IDE (if already installed):",
          "  Arduino ships with avr-gcc. Set the path manually in crystal-11 settings:",
          "  crystal11.avrGccPath = /path/to/Arduino.app/Contents/Java/hardware/tools/avr/bin/avr-gcc",
          "",
          "If you already ran brew install and it's compiling — just let it finish.",
        ].join("\n"),
      };
    case "linux":
      return {
        platform: "Linux",
        command: "sudo apt install gcc-avr avr-libc",
        note: "On Arch: sudo pacman -S avr-gcc avr-libc",
        url: "https://www.nongnu.org/avr-libc/",
      };
    case "win32":
      return {
        platform: "Windows",
        command: "winget install WinAVR  OR  scoop install avr-gcc",
        url: "https://github.com/avrdudes/avr-libc",
        note: "WinAVR is the traditional option. Scoop is recommended for newer setups.",
      };
    default:
      return {
        platform: process.platform,
        command: "Install avr-gcc and avr-libc for your distribution",
        url: "https://www.nongnu.org/avr-libc/",
        note: "",
      };
  }
}