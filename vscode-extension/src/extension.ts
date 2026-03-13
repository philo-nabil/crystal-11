import * as vscode from "vscode";
import { WizardPanel } from "./wizardPanel";
import { flashDevice } from "./flashCommand";

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
