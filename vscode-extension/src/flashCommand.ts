import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { isSafePath } from "./utils/validate";
import { resolveAvrdude, showInstallGuide } from "./utils/toolchain";

const execFileAsync = promisify(execFile);

type Programmer = "usbasp" | "avrispmkII" | "arduino" | "stk500";

const PROGRAMMER_ID: Record<Programmer, string> = {
  usbasp:     "usbasp",
  avrispmkII: "avrispmkII",
  arduino:    "arduino",
  stk500:     "stk500",
};

export async function flashDevice(hexPath: string): Promise<void> {
  // Validate hex path
  const resolved = path.resolve(hexPath);
  if (!resolved.endsWith(".hex")) {
    vscode.window.showErrorMessage("crystal-11: Target file must be a .hex file.");
    return;
  }

  // Path traversal guard: ensure the hex file is inside the workspace.
  // hexPath comes from findFiles/showQuickPick (workspace-scoped) or a Uri
  // from the explorer context menu — still validate to be safe.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot && !isSafePath(resolved, workspaceRoot)) {
    vscode.window.showErrorMessage(
      "crystal-11: .hex file must be inside the workspace folder."
    );
    return;
  }

  // Find avrdude instead of assuming it's on PATH — a GUI-launched VS Code
  // often has a minimal PATH, and Arduino IDE's avrdude never is.
  const avrdude = await resolveAvrdude();
  if (!avrdude) {
    const choice = await vscode.window.showErrorMessage(
      "crystal-11: avrdude not found on your system.",
      "Show Install Instructions", "Set Path Manually"
    );
    if (choice === "Show Install Instructions") {
      await showInstallGuide();
    } else if (choice === "Set Path Manually") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "crystal11.avrdudePath");
    }
    return;
  }

  const config = vscode.workspace.getConfiguration("crystal11");
  const programmer = (config.get<string>("programmer") ?? "usbasp") as Programmer;
  const port = config.get<string>("avrdudePort") ?? "usb";
  const extra = config.get<string>("avrdudeExtra") ?? "";

  // Build args array — never use string interpolation with shell
  const args: string[] = [
    "-p", "m32",
    "-c", PROGRAMMER_ID[programmer] ?? "usbasp",
    "-P", port,
    "-U", `flash:w:${resolved}:i`,
  ];

  // arduino needs baud rate
  if (programmer === "arduino") {
    args.push("-b", "19200");
  }

  // Append any extra flags (split safely)
  if (extra.trim()) {
    args.push(...extra.trim().split(/\s+/));
  }

  // Run avrdude exactly once. This used to also sendText() the same command
  // to a terminal, so two avrdude processes raced for the programmer and one
  // of them always failed. Output goes to an output channel instead.
  const output = getOutputChannel();
  output.show(true);
  output.appendLine(`> ${avrdude} ${args.join(" ")}`);

  vscode.window.showInformationMessage(
    `crystal-11: Flashing ${path.basename(resolved)}...`
  );

  try {
    // avrdude writes all of its progress to stderr, even on success.
    const { stdout, stderr } = await execFileAsync(avrdude, args);
    if (stdout) { output.append(stdout); }
    if (stderr) { output.append(stderr); }
    if (stderr && !stderr.includes("bytes of flash verified")) {
      vscode.window.showWarningMessage(`avrdude: ${stderr.trim().split("\n")[0]}`);
    } else {
      vscode.window.showInformationMessage("crystal-11: Flash complete.");
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    if (e.stderr) { output.append(e.stderr); }
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`crystal-11: Flash failed — ${msg}`);
  }
}

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel("crystal-11 Flash");
  return outputChannel;
}