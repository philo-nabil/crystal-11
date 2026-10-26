import * as fs from "fs";
import * as vscode from "vscode";
import { locate, siblingTool, deriveInclude } from "./locate";

// ── Public API ────────────────────────────────────────────────────────────────

export interface ToolchainInfo {
  /** Absolute path to the avr-gcc binary */
  gccPath: string;
  /** avr-objcopy from the same toolchain (falls back to plain "avr-objcopy") */
  objcopyPath: string;
  /** avr-libc include dir, or null if it couldn't be found */
  includePath: string | null;
  /** Source: how we found it */
  source: "setting" | "autodetect";
}

/**
 * Resolve avr-gcc: check the user setting first, then auto-detect (PATH and
 * every common install location — see locate.ts). Returns null if nothing found.
 */
export async function resolveToolchain(): Promise<ToolchainInfo | null> {
  // 1. Settings override
  const cfg = vscode.workspace.getConfiguration("crystal11");
  const settingPath = cfg.get<string>("avrGccPath", "").trim();
  if (settingPath) {
    if (fs.existsSync(settingPath)) {
      return describe(settingPath, "setting");
    }
    // User configured something but it doesn't exist — warn and fall through
    vscode.window.showWarningMessage(
      `crystal-11: crystal11.avrGccPath is set to "${settingPath}" but that file doesn't exist. Falling back to auto-detect.`
    );
  }

  // 2. Auto-detect
  const found = locate("avr-gcc");
  return found ? describe(found, "autodetect") : null;
}

function describe(gccPath: string, source: ToolchainInfo["source"]): ToolchainInfo {
  return {
    gccPath,
    objcopyPath: siblingTool(gccPath, "avr-objcopy") ?? "avr-objcopy",
    includePath: deriveInclude(gccPath),
    source,
  };
}

/**
 * Resolve avrdude: setting, then next to avr-gcc, then PATH / known locations
 * (Arduino IDE ships its own). Returns null if not found.
 */
export async function resolveAvrdude(): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration("crystal11");
  const settingPath = cfg.get<string>("avrdudePath", "").trim();
  if (settingPath && fs.existsSync(settingPath)) { return settingPath; }
  const gcc = await resolveToolchain();
  return gcc ? siblingTool(gcc.gccPath, "avrdude") : locate("avrdude");
}

// ── Install guidance ──────────────────────────────────────────────────────────

export interface InstallGuide {
  platform: string;
  command: string;
  url: string;
  note: string;
}

export function getInstallGuide(): InstallGuide {
  // Arduino IDE is the one option that works the same everywhere with no
  // terminal: it installs avr-gcc + avrdude, and crystal-11 finds them
  // automatically (see locate.ts).
  const arduino = [
    "Easiest on any OS: install the Arduino IDE (arduino.cc/en/software), open it once and let it install \"Arduino AVR Boards\". crystal-11 finds its avr-gcc and avrdude automatically — no settings needed.",
  ];
  switch (process.platform) {
    case "darwin":
      return {
        platform: "macOS",
        command: "brew tap osx-cross/avr && brew install avr-gcc avrdude",
        url: "https://github.com/osx-cross/homebrew-avr",
        note: [
          ...arduino,
          "",
          "Or with Homebrew (command above). If Homebrew has no pre-built bottle for your macOS version it compiles GCC from source, which can take 20–30 minutes.",
          "",
          "After installing, run \"crystal-11: Check avr-gcc Installation\" again.",
        ].join("\n"),
      };
    case "linux":
      return {
        platform: "Linux",
        command: "sudo apt install gcc-avr avr-libc avrdude",
        url: "https://www.nongnu.org/avr-libc/",
        note: [
          "Fedora: sudo dnf install avr-gcc avr-libc avrdude",
          "Arch: sudo pacman -S avr-gcc avr-libc avrdude",
          "",
          ...arduino,
        ].join("\n"),
      };
    case "win32":
      return {
        platform: "Windows",
        command: "winget install ArduinoSA.IDE.stable",
        url: "https://www.arduino.cc/en/software",
        note: [
          ...arduino,
          "",
          "Microchip Studio 7 and WinAVR installs are detected too.",
          "",
          "After installing, run \"crystal-11: Check avr-gcc Installation\" again.",
        ].join("\n"),
      };
    default:
      return {
        platform: process.platform,
        command: "Install avr-gcc, avr-libc and avrdude for your system",
        url: "https://www.nongnu.org/avr-libc/",
        note: arduino.join("\n"),
      };
  }
}

/** Modal install instructions with one-click actions. */
export async function showInstallGuide(): Promise<void> {
  const guide = getInstallGuide();
  const choice = await vscode.window.showInformationMessage(
    `crystal-11: Install avr-gcc and avrdude (${guide.platform})`,
    { modal: true, detail: `${guide.note}\n\nTerminal command:\n${guide.command}` },
    "Open Download Page",
    "Copy Command"
  );
  if (choice === "Open Download Page") {
    await vscode.env.openExternal(vscode.Uri.parse(guide.url));
  } else if (choice === "Copy Command") {
    await vscode.env.clipboard.writeText(guide.command);
    vscode.window.showInformationMessage("crystal-11: Command copied — paste it into a terminal.");
  }
}
