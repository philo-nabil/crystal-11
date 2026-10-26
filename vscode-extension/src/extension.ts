import * as vscode from "vscode";
import { WizardPanel } from "./wizardPanel";
import { flashDevice } from "./flashCommand";
import { resolveToolchain, resolveAvrdude, showInstallGuide } from "./utils/toolchain";
import { healProjectConfig } from "./projectConfig";

export function activate(context: vscode.ExtensionContext): void {

  // Open wizard command
  context.subscriptions.push(
    vscode.commands.registerCommand("crystal11.openWizard", () => {
      try {
        WizardPanel.createOrShow(context);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`crystal-11: Failed to open wizard — ${msg}`);
      }
    })
  );

  // Check avr-gcc installation — package.json declares this command but it
  // was never registered, so running it from the command palette failed
  // with "command not found."
  context.subscriptions.push(
    vscode.commands.registerCommand("crystal11.checkCompiler", async () => {
      const toolchain = await resolveToolchain();
      if (toolchain) {
        const src = toolchain.source === "setting" ? "from your settings" : "auto-detected";
        const avrdude = await resolveAvrdude();
        const flash = avrdude ? `avrdude → ${avrdude}` : "avrdude not found (needed only for flashing)";
        vscode.window.showInformationMessage(
          `crystal-11: avr-gcc found (${src}) → ${toolchain.gccPath}. ${flash}`
        );
      } else {
        const choice = await vscode.window.showErrorMessage(
          "crystal-11: avr-gcc not found on your system.",
          "Show Install Instructions",
          "Set Path Manually"
        );
        if (choice === "Show Install Instructions") {
          await showInstallGuide();
        } else if (choice === "Set Path Manually") {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings", "crystal11.avrGccPath"
          );
        }
      }
    })
  );

  // Projects carry absolute toolchain paths in .vscode/. When one is opened
  // on another computer (or avr-gcc was installed after creating it), point
  // it at this machine's toolchain so users never edit config by hand.
  healProjectConfig().catch((err) => console.error("crystal-11: heal failed", err));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      healProjectConfig().catch((err) => console.error("crystal-11: heal failed", err));
    })
  );

  // Flash command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "crystal11.flashDevice",
      async (uri?: vscode.Uri) => {
        try {
          let hexPath: string | undefined;

          if (uri) {
            hexPath = uri.fsPath;
          } else {
            const files = await vscode.workspace.findFiles(
              "**/*.hex",
              "**/node_modules/**",
              5
            );
            if (files.length === 0) {
              vscode.window.showErrorMessage(
                "crystal-11: No .hex file found in workspace."
              );
              return;
            }
            if (files.length === 1) {
              hexPath = files[0].fsPath;
            } else {
              const picked = await vscode.window.showQuickPick(
                files.map((f) => f.fsPath),
                { placeHolder: "Select .hex file to flash" }
              );
              if (!picked) {
                return;
              }
              hexPath = picked;
            }
          }

          if (!hexPath) {
            vscode.window.showErrorMessage("crystal-11: No .hex file selected.");
            return;
          }

          await flashDevice(hexPath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `crystal-11: Flash command failed — ${msg}`
          );
        }
      }
    )
  );
}

export function deactivate(): void {}
