import * as vscode from "vscode";
import * as fs from "fs";
import { ToolchainInfo, resolveToolchain } from "./utils/toolchain";

// Writes (and later repairs) the .vscode files of a crystal-11 project.
//
// The files contain absolute toolchain paths, which differ per laptop. A
// project created on one machine and opened on another — a classmate's, or a
// lab PC — would otherwise show "compiler not found" / include errors. So the
// project carries a small marker (.vscode/crystal11.json), and whenever a
// folder with that marker is opened, healProjectConfig() re-detects the local
// toolchain and rewrites the config if its paths don't exist on this machine.

const MARKER = "crystal11.json";
const DEFAULT_CLOCK_HZ = 11059200;

interface Marker {
  mcu: "atmega32a";
  clockHz: number;
}

const enc = new TextEncoder();

function clockOrDefault(clockHz?: number): number {
  return Number.isInteger(clockHz) && (clockHz as number) > 0 ? (clockHz as number) : DEFAULT_CLOCK_HZ;
}

async function writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, enc.encode(JSON.stringify(data, null, 2) + "\n"));
}

export async function writeProjectConfig(
  projectUri: vscode.Uri,
  toolchain: ToolchainInfo | null,
  clockHz?: number,
): Promise<void> {
  const vscodeDir = vscode.Uri.joinPath(projectUri, ".vscode");
  await vscode.workspace.fs.createDirectory(vscodeDir);

  const hz = clockOrDefault(clockHz);
  const fCpu = `F_CPU=${hz}UL`;

  // Without a detected toolchain fall back to bare names, which resolve
  // through PATH — never to a made-up absolute path. healProjectConfig()
  // fills in real paths once avr-gcc is installed.
  const gcc = toolchain?.gccPath ?? "avr-gcc";
  const objcopy = toolchain?.objcopyPath ?? "avr-objcopy";

  // IntelliSense: compilerPath + -mmcu lets the C/C++ extension ask avr-gcc
  // for its own system headers and __AVR_*__ defines, so nothing about the
  // install layout is hardcoded. intelliSenseMode is left unset — a desktop
  // mode like gcc-x64 is reported as a configuration error against avr-gcc.
  const includePath = ["${workspaceFolder}/**"];
  if (toolchain?.includePath) { includePath.push(toolchain.includePath); }
  await writeJson(vscode.Uri.joinPath(vscodeDir, "c_cpp_properties.json"), {
    configurations: [{
      name: "AVR",
      includePath,
      defines: [fCpu, "__AVR_ATmega32A__"],
      ...(toolchain ? { compilerPath: gcc } : {}),
      compilerArgs: ["-mmcu=atmega32a"],
      cStandard: "gnu11",
    }],
    version: 4,
  });

  // Build: two "process" tasks run in sequence. No shell is involved, so
  // there's no `&&` (unsupported by Windows PowerShell 5) and no quoting
  // problems with paths like "C:\Program Files (x86)\...".
  await writeJson(vscode.Uri.joinPath(vscodeDir, "tasks.json"), {
    version: "2.0.0",
    tasks: [
      {
        label: "crystal-11: compile main.elf",
        type: "process",
        command: gcc,
        args: ["-mmcu=atmega32a", `-D${fCpu}`, "-Os", "-Wall", "main.c", "-o", "main.elf"],
        options: { cwd: "${workspaceFolder}" },
        problemMatcher: ["$gcc"],
        presentation: { reveal: "always", panel: "shared" },
      },
      {
        label: "crystal-11: make main.hex",
        type: "process",
        command: objcopy,
        args: ["-O", "ihex", "-R", ".eeprom", "main.elf", "main.hex"],
        options: { cwd: "${workspaceFolder}" },
        problemMatcher: [],
        presentation: { reveal: "always", panel: "shared" },
      },
      {
        label: "crystal-11: build main.hex",
        dependsOn: ["crystal-11: compile main.elf", "crystal-11: make main.hex"],
        dependsOrder: "sequence",
        group: { kind: "build", isDefault: true },
        problemMatcher: [],
      },
    ],
  });

  // Prompt to install the C/C++ extension, which reads c_cpp_properties.json.
  await writeJson(vscode.Uri.joinPath(vscodeDir, "extensions.json"), {
    recommendations: ["ms-vscode.cpptools"],
  });

  const marker: Marker = { mcu: "atmega32a", clockHz: hz };
  await writeJson(vscode.Uri.joinPath(vscodeDir, MARKER), marker);
}

async function readJson<T>(uri: vscode.Uri): Promise<T | null> {
  try {
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    // c_cpp_properties.json / tasks.json may contain comments if the user edited them.
    return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as T;
  } catch {
    return null;
  }
}

// A configured tool path is fine if it's a bare name (PATH lookup) or exists here.
function pathOk(p: unknown): boolean {
  if (typeof p !== "string" || !p) { return false; }
  if (!/[\\/]/.test(p)) { return true; }
  return fs.existsSync(p);
}

async function needsRepair(folder: vscode.Uri, haveToolchain: boolean): Promise<boolean> {
  const vscodeDir = vscode.Uri.joinPath(folder, ".vscode");
  const props = await readJson<{ configurations?: { compilerPath?: string }[] }>(
    vscode.Uri.joinPath(vscodeDir, "c_cpp_properties.json"));
  const tasks = await readJson<{ tasks?: { command?: string }[] }>(
    vscode.Uri.joinPath(vscodeDir, "tasks.json"));
  if (!props || !tasks) { return true; }

  const compilerPath = props.configurations?.[0]?.compilerPath;
  // Created before avr-gcc was installed, and it's installed now.
  if (compilerPath === undefined) { return haveToolchain; }
  if (!pathOk(compilerPath)) { return true; }
  return (tasks.tasks ?? []).some((t) => t.command !== undefined && !pathOk(t.command));
}

/** Re-detect the toolchain for every open crystal-11 project and fix stale paths. */
export async function healProjectConfig(): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const marker = await readJson<Marker>(vscode.Uri.joinPath(folder.uri, ".vscode", MARKER));
    if (!marker) { continue; }

    const toolchain = await resolveToolchain();
    if (!(await needsRepair(folder.uri, toolchain !== null))) { continue; }

    await writeProjectConfig(folder.uri, toolchain, marker.clockHz);
    if (toolchain) {
      vscode.window.showInformationMessage(
        `crystal-11: Updated "${folder.name}" to use avr-gcc at ${toolchain.gccPath}.`
      );
    } else {
      const choice = await vscode.window.showWarningMessage(
        `crystal-11: "${folder.name}" needs avr-gcc, which isn't installed on this computer.`,
        "How to Install"
      );
      if (choice === "How to Install") {
        await vscode.commands.executeCommand("crystal11.checkCompiler");
      }
    }
  }
}
