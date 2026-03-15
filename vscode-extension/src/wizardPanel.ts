import * as vscode from "vscode";
import * as crypto from "crypto";
import { generateCode } from "crystal-11-core";
import { WizardConfig } from "crystal-11-core/types";
import { isSafePath } from "./utils/validate";
import { resolveToolchain, getInstallGuide } from "./utils/toolchain";

// Security: hex encoding — no padding chars (+, /, =) unlike base64.
// Skill rule: nonces must use hex encoding, not base64.
function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export class WizardPanel {
  public static currentPanel: WizardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  // Guard against re-entrant dispose: _panel.dispose() fires onDidDispose
  // synchronously, which calls this.dispose() again before the first call
  // finishes — without this flag we'd double-dispose.
  private _disposed = false;

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (WizardPanel.currentPanel) {
      WizardPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "crystal11Wizard",
      "crystal-11 AVR Wizard",
      column,
      {
        enableScripts: true,
        // retainContextWhenHidden: false (default) — fine here, state is
        // reconstructed from the form on re-open.
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      }
    );

    WizardPanel.currentPanel = new WizardPanel(panel, context.extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: {
        command: string;
        config?: WizardConfig;
        meta?: Record<string, string>;
        code?: string;
      }) => {
        switch (message.command) {
          case "generate":
            if (message.config) {
              await this._handleGenerate(message.config, message.meta ?? {});
            }
            break;
          case "saveToFile":
            if (message.code !== undefined) {
              await this._handleSaveToFile(message.code);
            }
            break;
          case "createProject":
            if (message.code !== undefined) {
              await this._handleCreateProject(message.code);
            }
            break;
          default:
            console.warn(`crystal-11: unknown webview message: ${message.command}`);
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleGenerate(
    config: WizardConfig,
    meta: Record<string, string>
  ): Promise<void> {
    try {
      const code = generateCode(config, meta);
      this._panel.webview.postMessage({ command: "codeReady", code });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `crystal-11: Code generation failed — ${msg}`
      );
    }
  }

  private async _handleSaveToFile(code: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder.uri, "main.c")
      : undefined;

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "C Source": ["c"] },
      saveLabel: "Save main.c",
    });

    if (!uri) {
      return;
    }

    // Path traversal guard: verify the save target is inside the workspace.
    // showSaveDialog provides user intent but we check programmatically too.
    if (
      workspaceFolder &&
      !isSafePath(uri.fsPath, workspaceFolder.uri.fsPath)
    ) {
      vscode.window.showErrorMessage(
        "crystal-11: Save location must be inside the workspace folder."
      );
      return;
    }

    // Use vscode.workspace.fs — respects remote workspaces (SSH, WSL, Codespaces).
    // Node's fs.writeFileSync does not.
    // TextEncoder returns a native Uint8Array, avoiding the Buffer/ArrayBuffer
    // type mismatch that occurs with newer @types/node versions.
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(code));

    vscode.window.showInformationMessage(
      `crystal-11: Saved to ${uri.path.split("/").pop()}`
    );

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }

  private async _handleCreateProject(code: string): Promise<void> {
    const enc = new TextEncoder();

    // ── 1. Resolve avr-gcc ────────────────────────────────────────────────────
    const toolchain = await resolveToolchain();

    if (!toolchain) {
      const guide = getInstallGuide();
      const choice = await vscode.window.showErrorMessage(
        `crystal-11: avr-gcc not found on your system.`,
        "Show Install Instructions",
        "Set Path Manually",
        "Continue Anyway"
      );
      if (choice === "Show Install Instructions") {
        await vscode.window.showInformationMessage(
          `Run this in your terminal:\n${guide.command}`,
          { modal: true, detail: guide.note }
        );
        return;
      } else if (choice === "Set Path Manually") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings", "crystal11.avrGccPath"
        );
        return;
      } else if (choice !== "Continue Anyway") {
        return;
      }
    } else {
      const src = toolchain.source === "setting" ? "from your settings" : "auto-detected";
      vscode.window.setStatusBarMessage(
        `crystal-11: avr-gcc ${src} → ${toolchain.gccPath}`, 5000
      );
    }

    // ── 2. Pick parent folder ─────────────────────────────────────────────────
    const parentUris = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: "Select parent folder",
      title: "crystal-11: Choose where to create the project",
    });
    if (!parentUris || parentUris.length === 0) { return; }
    const parentUri = parentUris[0];

    // ── 3. Pick project name ──────────────────────────────────────────────────
    const projectName = await vscode.window.showInputBox({
      prompt: "Project name (will become the folder name)",
      value: "avr-project",
      validateInput: (v) => {
        if (!v.trim()) { return "Name cannot be empty"; }
        if (!/^[\w\-. ]+$/.test(v)) { return "Use only letters, digits, hyphens, underscores, dots"; }
        return undefined;
      },
    });
    if (!projectName) { return; }

    const projectUri = vscode.Uri.joinPath(parentUri, projectName.trim());

    // ── 4. Create folders ─────────────────────────────────────────────────────
    await vscode.workspace.fs.createDirectory(projectUri);
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(projectUri, ".vscode")
    );

    // ── 5. Write main.c ───────────────────────────────────────────────────────
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(projectUri, "main.c"),
      enc.encode(code)
    );

    // ── 6. Write .vscode/c_cpp_properties.json ────────────────────────────────
    const gccPath    = toolchain?.gccPath    ?? (process.platform === "win32"
      ? "C:\\WinAVR-20100110\\bin\\avr-gcc.exe"
      : "/usr/bin/avr-gcc");
    const includeDir = toolchain?.includePath ?? "/usr/avr/include";

    const cppProps = {
      configurations: [{
        name: "AVR",
        includePath: [
          includeDir,
          "/opt/homebrew/avr/include",
          "/usr/local/avr/include",
          "/usr/lib/avr/include",
          "\${workspaceFolder}/**",
        ],
        defines: ["F_CPU=11059200UL", "__AVR_ATmega32A__"],
        compilerPath: gccPath,
        cStandard: "gnu99",
        intelliSenseMode: "gcc-x64",
      }],
      version: 4,
    };

    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(projectUri, ".vscode", "c_cpp_properties.json"),
      enc.encode(JSON.stringify(cppProps, null, 2))
    );

    // ── 7. Open project ───────────────────────────────────────────────────────
    const note = toolchain
      ? `avr-gcc found at ${toolchain.gccPath}`
      : "⚠️ avr-gcc not found — install it before building";

    const choice = await vscode.window.showInformationMessage(
      `crystal-11: Project "${projectName.trim()}" created. ${note}`,
      "Open Folder", "Open in New Window"
    );

    if (choice === "Open Folder") {
      await vscode.commands.executeCommand("vscode.openFolder", projectUri, false);
    } else if (choice === "Open in New Window") {
      await vscode.commands.executeCommand("vscode.openFolder", projectUri, true);
    }
  }

  private _update(): void {
    const webview = this._panel.webview;
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    // Styles live in media/style.css — served via webviewUri so they pass the
    // style-src CSP directive. Inline <style> blocks are blocked by a correct
    // CSP and must never be used.
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "style.css")
    );

    // Escape values inserted into the CSP string — a semicolon or space in
    // cspSource could inject arbitrary CSP directives.
    const esc = (s: string): string =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
      );

    // connect-src 'none': webview makes no external fetch calls.
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${cspSource}`,
      `img-src ${cspSource} data:`,
      `font-src ${cspSource}`,
      "connect-src 'none'",
    ].join("; ");

    this._panel.webview.html = this._buildHtml(
      nonce,
      esc(csp),
      esc(styleUri.toString())
    );
  }

  private _buildHtml(nonce: string, csp: string, styleUri: string): string {
    // bodyContent is a hardcoded string — no user data flows in here.
    // acquireVsCodeApi() is called inside the nonced <script> tag below.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link href="${styleUri}" rel="stylesheet">
  <title>crystal-11 AVR Wizard</title>
</head>
<body>

<nav class="sidebar">
  <div class="sidebar-item active" data-panel="chip" data-action="nav"><span class="dot"></span> Chip</div>
  <div class="sidebar-item" data-panel="ports" data-action="nav"><span class="dot"></span> Ports</div>
  <div class="sidebar-item" data-panel="usart" data-action="nav"><span class="dot"></span> USART</div>
  <div class="sidebar-item" data-panel="adc" data-action="nav"><span class="dot"></span> ADC</div>
  <div class="sidebar-item" data-panel="timer0" data-action="nav"><span class="dot"></span> Timer 0</div>
  <div class="sidebar-item" data-panel="timer1" data-action="nav"><span class="dot"></span> Timer 1</div>
  <div class="sidebar-item" data-panel="timer2" data-action="nav"><span class="dot"></span> Timer 2</div>
  <div class="sidebar-item" data-panel="spi" data-action="nav"><span class="dot"></span> SPI</div>
  <div class="sidebar-item" data-panel="i2c" data-action="nav"><span class="dot"></span> I2C (TWI)</div>
  <div class="sidebar-item" data-panel="interrupts" data-action="nav"><span class="dot"></span> Interrupts</div>
  <div class="sidebar-item" data-panel="meta" data-action="nav"><span class="dot"></span> Project Info</div>
</nav>

<div class="main">

  <div class="panel active" id="panel-chip">
    <h2>Chip Settings</h2>
    <div class="field"><label>Chip</label><select disabled><option>ATmega32A</option></select></div>
    <div class="field">
      <label>Clock Frequency (Hz)</label>
      <input type="text" id="clockHz" value="11059200" placeholder="e.g. 11059200" data-action="update" style="max-width:180px">
      <div class="field-hint" id="clock-mhz-display">= 11.0592 MHz</div>
    </div>
  </div>

  <div class="panel" id="panel-ports">
    <h2>I/O Ports</h2>
    <div class="ports-layout">

      <!-- Left: port tabs + pin table -->
      <div class="ports-left">
        <div class="port-tabs" id="port-tabs">
          <button class="port-tab active" data-port="A">Port A</button>
          <button class="port-tab" data-port="B">Port B</button>
          <button class="port-tab" data-port="C">Port C</button>
          <button class="port-tab" data-port="D">Port D</button>
        </div>
        <div id="port-table-container"></div>
      </div>

      <!-- Right: ATmega32A chip schematic -->
      <div class="ports-right">
        <div class="schematic-label">ATmega32A pinout</div>
        <div id="schematic-container"></div>
        <div class="schematic-legend">
          <span class="leg-item"><span class="leg-dot leg-dot--tristate"></span>In / Tristate</span>
          <span class="leg-item"><span class="leg-dot leg-dot--pullup"></span>In / Pullup</span>
          <span class="leg-item"><span class="leg-dot leg-dot--low"></span>Out / Low</span>
          <span class="leg-item"><span class="leg-dot leg-dot--high"></span>Out / High</span>
        </div>
      </div>

    </div>
  </div>

  <div class="panel" id="panel-usart">
    <h2>USART</h2>
    <div class="section-enable">
      <input type="checkbox" id="usart-enabled" data-action="toggle" data-section="usart">
      <label for="usart-enabled">Enable USART</label>
    </div>
    <div class="collapsible" id="usart-section">
      <div class="row">
        <div class="field"><label>Baud Rate</label>
          <select id="usart-baud" data-action="update">
            <option>1200</option><option>2400</option><option>4800</option>
            <option selected>9600</option><option>14400</option><option>19200</option>
            <option>38400</option><option>57600</option><option>115200</option>
          </select>
        </div>
        <div class="field"><label>Mode</label>
          <select id="usart-mode" data-action="update">
            <option value="async">Asynchronous</option>
            <option value="sync_master_cpol0">Sync Master UCPOL=0</option>
            <option value="sync_master_cpol1">Sync Master UCPOL=1</option>
            <option value="sync_slave_cpol0">Sync Slave UCPOL=0</option>
            <option value="sync_slave_cpol1">Sync Slave UCPOL=1</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Communication Parameters</label>
          <select id="usart-params" data-action="update">
            <option value="8,1,none">8 Data, 1 Stop, No Parity</option>
            <option value="8,2,none">8 Data, 2 Stop, No Parity</option>
            <option value="8,1,even">8 Data, 1 Stop, Even Parity</option>
            <option value="8,1,odd">8 Data, 1 Stop, Odd Parity</option>
            <option value="7,1,none">7 Data, 1 Stop, No Parity</option>
            <option value="7,2,none">7 Data, 2 Stop, No Parity</option>
            <option value="7,1,even">7 Data, 1 Stop, Even Parity</option>
            <option value="7,1,odd">7 Data, 1 Stop, Odd Parity</option>
            <option value="9,1,none">9 Data, 1 Stop, No Parity</option>
          </select>
        </div>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="usart-rx" checked data-action="update"><label for="usart-rx">Receiver</label></div>
      <div class="checkbox-row"><input type="checkbox" id="usart-tx" checked data-action="update"><label for="usart-tx">Transmitter</label></div>
      <div class="checkbox-row"><input type="checkbox" id="usart-rxint" data-action="update"><label for="usart-rxint">Rx Interrupt (ring buffer)</label></div>
      <div class="checkbox-row"><input type="checkbox" id="usart-txint" data-action="update"><label for="usart-txint">Tx Interrupt (ring buffer)</label></div>
    </div>
  </div>

  <div class="panel" id="panel-adc">
    <h2>Analog to Digital Converter</h2>
    <div class="section-enable">
      <input type="checkbox" id="adc-enabled" data-action="toggle" data-section="adc">
      <label for="adc-enabled">Enable ADC</label>
    </div>
    <div class="collapsible" id="adc-section">
      <div class="row">
        <div class="field"><label>Voltage Reference</label>
          <select id="adc-vref" data-action="update">
            <option value="aref">AREF pin</option>
            <option value="avcc">AVCC pin</option>
            <option value="internal">Internal 2.56V</option>
          </select>
        </div>
        <div class="field"><label>Clock</label>
          <select id="adc-clock" data-action="update">
            <option value="125">125 kHz</option><option value="250">250 kHz</option>
            <option value="500">500 kHz</option><option value="1000" selected>1000 kHz</option>
            <option value="2000">2000 kHz</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Auto Trigger Source</label>
        <select id="adc-trigger" data-action="update">
          <option value="stopped">ADC Stopped</option>
          <option value="free_running">Free Running</option>
          <option value="analog_comparator">Analog Comparator</option>
          <option value="ext_irq0">External IRQ0</option>
          <option value="timer0_compare">Timer0 Compare Match</option>
          <option value="timer0_overflow">Timer0 Overflow</option>
          <option value="timer1_compare_b">Timer1 Compare Match B</option>
          <option value="timer1_overflow">Timer1 Overflow</option>
          <option value="timer1_capture">Timer1 Capture Event</option>
        </select>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="adc-8bit" data-action="update"><label for="adc-8bit">Use 8 bits (ADLAR)</label></div>
      <div class="checkbox-row"><input type="checkbox" id="adc-interrupt" data-action="update"><label for="adc-interrupt">Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="adc-noise" data-action="update"><label for="adc-noise">Noise Canceler</label></div>
    </div>
  </div>

  <div class="panel" id="panel-timer0">
    <h2>Timer / Counter 0</h2>
    <div class="section-enable">
      <input type="checkbox" id="t0-enabled" data-action="toggle" data-section="t0">
      <label for="t0-enabled">Enable Timer 0</label>
    </div>
    <div class="collapsible" id="t0-section">
      <div class="row">
        <div class="field"><label>Mode</label>
          <select id="t0-mode" data-action="update">
            <option value="normal">Normal top=FFh</option><option value="ctc">CTC top=OCR0</option>
            <option value="fast_pwm">Fast PWM top=FFh</option><option value="phase_correct_pwm">Phase Correct PWM top=FFh</option>
          </select>
        </div>
        <div class="field"><label>Prescaler</label>
          <select id="t0-prescaler" data-action="update">
            <option value="off">Timer Stopped</option><option value="1">1</option><option value="8">8</option>
            <option value="64">64</option><option value="256" selected>256</option><option value="1024">1024</option>
            <option value="ext_falling">Ext Falling</option><option value="ext_rising">Ext Rising</option>
          </select>
        </div>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="t0-ovf" data-action="update"><label for="t0-ovf">Overflow Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t0-cmp" data-action="update"><label for="t0-cmp">Compare Match Interrupt</label></div>
    </div>
  </div>

  <div class="panel" id="panel-timer1">
    <h2>Timer / Counter 1</h2>
    <div class="section-enable">
      <input type="checkbox" id="t1-enabled" data-action="toggle" data-section="t1">
      <label for="t1-enabled">Enable Timer 1</label>
    </div>
    <div class="collapsible" id="t1-section">
      <div class="row">
        <div class="field"><label>Prescaler</label>
          <select id="t1-prescaler" data-action="update">
            <option value="off">Timer Stopped</option><option value="1">1</option><option value="8">8</option>
            <option value="64">64</option><option value="256" selected>256</option><option value="1024">1024</option>
            <option value="ext_falling">Ext Falling</option><option value="ext_rising">Ext Rising</option>
          </select>
        </div>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="t1-ovf" data-action="update"><label for="t1-ovf">Overflow Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t1-cmpa" data-action="update"><label for="t1-cmpa">Compare A Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t1-cmpb" data-action="update"><label for="t1-cmpb">Compare B Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t1-cap" data-action="update"><label for="t1-cap">Input Capture Interrupt</label></div>
    </div>
  </div>

  <div class="panel" id="panel-timer2">
    <h2>Timer / Counter 2</h2>
    <div class="section-enable">
      <input type="checkbox" id="t2-enabled" data-action="toggle" data-section="t2">
      <label for="t2-enabled">Enable Timer 2</label>
    </div>
    <div class="collapsible" id="t2-section">
      <div class="row">
        <div class="field"><label>Mode</label>
          <select id="t2-mode" data-action="update">
            <option value="normal">Normal top=FFh</option><option value="ctc">CTC top=OCR2</option>
            <option value="fast_pwm">Fast PWM top=FFh</option><option value="phase_correct_pwm">Phase Correct PWM top=FFh</option>
          </select>
        </div>
        <div class="field"><label>Prescaler</label>
          <select id="t2-prescaler" data-action="update">
            <option value="off">Timer Stopped</option><option value="1">1</option><option value="8">8</option>
            <option value="32">32</option><option value="64">64</option><option value="128">128</option>
            <option value="256" selected>256</option><option value="1024">1024</option>
          </select>
        </div>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="t2-ovf" data-action="update"><label for="t2-ovf">Overflow Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t2-cmp" data-action="update"><label for="t2-cmp">Compare Match Interrupt</label></div>
      <div class="checkbox-row"><input type="checkbox" id="t2-async" data-action="update"><label for="t2-async">Asynchronous (32.768 kHz crystal)</label></div>
    </div>
  </div>

  <div class="panel" id="panel-spi">
    <h2>Serial Peripheral Interface</h2>
    <div class="section-enable">
      <input type="checkbox" id="spi-enabled" data-action="toggle" data-section="spi">
      <label for="spi-enabled">Enable SPI</label>
    </div>
    <div class="collapsible" id="spi-section">
      <div class="row">
        <div class="field"><label>Mode</label>
          <select id="spi-mode" data-action="update"><option value="master">Master</option><option value="slave">Slave</option></select>
        </div>
        <div class="field"><label>Clock Rate</label>
          <select id="spi-clock" data-action="update">
            <option value="fosc_4">Fosc/4</option><option value="fosc_16" selected>Fosc/16</option>
            <option value="fosc_64">Fosc/64</option><option value="fosc_128">Fosc/128</option>
            <option value="fosc_2">Fosc/2</option><option value="fosc_8">Fosc/8</option><option value="fosc_32">Fosc/32</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Clock Polarity (CPOL)</label>
          <select id="spi-cpol" data-action="update">
            <option value="0">0 — Low when idle</option><option value="1">1 — High when idle</option>
          </select>
        </div>
        <div class="field"><label>Clock Phase (CPHA)</label>
          <select id="spi-cpha" data-action="update">
            <option value="0">0 — Sample on leading edge</option><option value="1">1 — Sample on trailing edge</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Data Order</label>
        <select id="spi-order" data-action="update"><option value="msb">MSB First</option><option value="lsb">LSB First</option></select>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="spi-interrupt" data-action="update"><label for="spi-interrupt">Interrupt</label></div>
    </div>
  </div>

  <div class="panel" id="panel-i2c">
    <h2>Two Wire Interface (I2C)</h2>
    <div class="section-enable">
      <input type="checkbox" id="i2c-enabled" data-action="toggle" data-section="i2c">
      <label for="i2c-enabled">Enable I2C</label>
    </div>
    <div class="collapsible" id="i2c-section">
      <div class="row">
        <div class="field"><label>Bit Rate (kHz)</label>
          <select id="i2c-bitrate" data-action="update">
            <option value="100" selected>100 kHz (Standard)</option><option value="400">400 kHz (Fast)</option>
            <option value="50">50 kHz</option><option value="200">200 kHz</option>
          </select>
        </div>
        <div class="field"><label>Slave Address (hex)</label>
          <input type="text" id="i2c-addr" value="0x00" maxlength="4" data-action="update">
        </div>
      </div>
      <hr class="divider">
      <div class="checkbox-row"><input type="checkbox" id="i2c-gcr" data-action="update"><label for="i2c-gcr">General Call Recognition</label></div>
      <div class="checkbox-row"><input type="checkbox" id="i2c-interrupt" data-action="update"><label for="i2c-interrupt">Interrupt</label></div>
    </div>
  </div>

  <div class="panel" id="panel-interrupts">
    <h2>External Interrupts</h2>
    <div class="int-group">
      <div class="checkbox-row"><input type="checkbox" id="int0-enabled" data-action="update"><label for="int0-enabled"><strong>INT0</strong> (PD2)</label></div>
      <div class="field int-trigger"><label>Trigger</label>
        <select id="int0-trigger" data-action="update">
          <option value="low_level">Low Level</option><option value="any_change">Any Change</option>
          <option value="falling" selected>Falling Edge</option><option value="rising">Rising Edge</option>
        </select>
      </div>
    </div>
    <div class="int-group">
      <div class="checkbox-row"><input type="checkbox" id="int1-enabled" data-action="update"><label for="int1-enabled"><strong>INT1</strong> (PD3)</label></div>
      <div class="field int-trigger"><label>Trigger</label>
        <select id="int1-trigger" data-action="update">
          <option value="low_level">Low Level</option><option value="any_change">Any Change</option>
          <option value="falling" selected>Falling Edge</option><option value="rising">Rising Edge</option>
        </select>
      </div>
    </div>
    <div class="int-group">
      <div class="checkbox-row"><input type="checkbox" id="int2-enabled" data-action="update"><label for="int2-enabled"><strong>INT2</strong> (PB2)</label></div>
      <div class="field int-trigger"><label>Trigger</label>
        <select id="int2-trigger" data-action="update">
          <option value="falling" selected>Falling Edge</option><option value="rising">Rising Edge</option>
        </select>
      </div>
    </div>
  </div>

  <div class="panel" id="panel-meta">
    <h2>Project Information</h2>
    <div class="field"><label>Project Name</label><input type="text" id="meta-project" placeholder="MyProject" data-action="update"></div>
    <div class="field"><label>Version</label><input type="text" id="meta-version" placeholder="1.0" data-action="update"></div>
    <div class="field"><label>Author</label><input type="text" id="meta-author" placeholder="Your name" data-action="update"></div>
    <div class="field"><label>Company</label><input type="text" id="meta-company" placeholder="Your company" data-action="update"></div>
    <div class="field"><label>Comments</label><input type="text" id="meta-comments" placeholder="Optional notes" data-action="update"></div>
  </div>

  <div class="toolbar">
    <button class="btn-primary" id="btn-generate">Generate Code</button>
    <button class="btn-secondary" id="btn-save" disabled>Save main.c</button>
    <button class="btn-accent" id="btn-create-project" disabled>Create Project</button>
    <span class="hint" id="hint">Configure peripherals, then click Generate.</span>
  </div>
</div>

<div class="preview-area">
  <div class="preview-header"><span>main.c preview</span></div>
  <pre id="code-preview">// Configure peripherals on the left,
// then click Generate Code.</pre>
</div>

<script nonce="${nonce}">
// acquireVsCodeApi() must be called inside the nonced script tag.
// Inline onclick="..." handlers are blocked by CSP — use event delegation.
const vscode = acquireVsCodeApi();
let lastCode = '';

document.addEventListener('change', handleEvent);
document.addEventListener('input', handleEvent);
document.addEventListener('click', handleEvent);

function handleEvent(e) {
  const target = e.target;
  if (!target) { return; }
  const action = target.dataset ? target.dataset.action : null;
  if (!action) { return; }
  if (action === 'nav' && e.type === 'click') {
    const item = target.closest ? target.closest('[data-panel]') : null;
    if (item) { showPanel(item.dataset.panel); }
  } else if (action === 'toggle' && e.type === 'change') {
    toggleSection(target.dataset.section);
  } else if (action === 'update') {
    onSettingChange();
  }
}

document.getElementById('btn-generate').addEventListener('click', generate);
document.getElementById('btn-save').addEventListener('click', saveToFile);
document.getElementById('btn-create-project').addEventListener('click', createProject);

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.sidebar-item').forEach(function(s) { s.classList.remove('active'); });
  var panelEl = document.getElementById('panel-' + name);
  if (panelEl) { panelEl.classList.add('active'); }
  var navEl = document.querySelector('[data-panel="' + name + '"]');
  if (navEl) { navEl.classList.add('active'); }
}

function toggleSection(name) {
  if (!name) { return; }
  var cbEl = document.getElementById(name + '-enabled');
  var section = document.getElementById(name + '-section');
  if (!cbEl || !section) { return; }
  var enabled = cbEl.checked;
  if (enabled) { section.classList.add('visible'); } else { section.classList.remove('visible'); }
  var panelMap = { usart: 'usart', adc: 'adc', t0: 'timer0', t1: 'timer1', t2: 'timer2', spi: 'spi', i2c: 'i2c' };
  var panelName = panelMap[name];
  if (panelName) {
    var sidebarItem = document.querySelector('[data-panel="' + panelName + '"]');
    if (sidebarItem) {
      if (enabled) { sidebarItem.classList.add('enabled'); } else { sidebarItem.classList.remove('enabled'); }
    }
  }
}

function onSettingChange() {
  var intEnabled = ['int0-enabled','int1-enabled','int2-enabled'].some(function(id) {
    var el = document.getElementById(id); return el && el.checked;
  });
  var intItem = document.querySelector('[data-panel="interrupts"]');
  if (intItem) {
    if (intEnabled) { intItem.classList.add('enabled'); } else { intItem.classList.remove('enabled'); }
  }
  updateSchematic();
  updateClockDisplay();
}

// ── ATmega32A pinout data ──────────────────────────────────────────────────────
// Maps each physical pin to its port/bit. null port = power/special pin.
var MEGA32_PINS = [
  // left side, top→bottom (pins 1-20)
  {num:1,  name:'PB0',   side:'L', idx:0,  port:'B', bit:0},
  {num:2,  name:'PB1',   side:'L', idx:1,  port:'B', bit:1},
  {num:3,  name:'PB2',   side:'L', idx:2,  port:'B', bit:2},
  {num:4,  name:'PB3',   side:'L', idx:3,  port:'B', bit:3},
  {num:5,  name:'PB4',   side:'L', idx:4,  port:'B', bit:4},
  {num:6,  name:'PB5',   side:'L', idx:5,  port:'B', bit:5},
  {num:7,  name:'PB6',   side:'L', idx:6,  port:'B', bit:6},
  {num:8,  name:'PB7',   side:'L', idx:7,  port:'B', bit:7},
  {num:9,  name:'/RST',  side:'L', idx:8,  port:null, bit:null},
  {num:10, name:'VCC',   side:'L', idx:9,  port:null, bit:null},
  {num:11, name:'GND',   side:'L', idx:10, port:null, bit:null},
  {num:12, name:'XTAL2', side:'L', idx:11, port:null, bit:null},
  {num:13, name:'XTAL1', side:'L', idx:12, port:null, bit:null},
  {num:14, name:'PD0',   side:'L', idx:13, port:'D', bit:0},
  {num:15, name:'PD1',   side:'L', idx:14, port:'D', bit:1},
  {num:16, name:'PD2',   side:'L', idx:15, port:'D', bit:2},
  {num:17, name:'PD3',   side:'L', idx:16, port:'D', bit:3},
  {num:18, name:'PD4',   side:'L', idx:17, port:'D', bit:4},
  {num:19, name:'PD5',   side:'L', idx:18, port:'D', bit:5},
  {num:20, name:'PD6',   side:'L', idx:19, port:'D', bit:6},
  // right side, top→bottom = pins 40 down to 21
  {num:40, name:'PA0',   side:'R', idx:0,  port:'A', bit:0},
  {num:39, name:'PA1',   side:'R', idx:1,  port:'A', bit:1},
  {num:38, name:'PA2',   side:'R', idx:2,  port:'A', bit:2},
  {num:37, name:'PA3',   side:'R', idx:3,  port:'A', bit:3},
  {num:36, name:'PA4',   side:'R', idx:4,  port:'A', bit:4},
  {num:35, name:'PA5',   side:'R', idx:5,  port:'A', bit:5},
  {num:34, name:'PA6',   side:'R', idx:6,  port:'A', bit:6},
  {num:33, name:'PA7',   side:'R', idx:7,  port:'A', bit:7},
  {num:32, name:'AREF',  side:'R', idx:8,  port:null, bit:null},
  {num:31, name:'AGND',  side:'R', idx:9,  port:null, bit:null},
  {num:30, name:'AVCC',  side:'R', idx:10, port:null, bit:null},
  {num:29, name:'PC7',   side:'R', idx:11, port:'C', bit:7},
  {num:28, name:'PC6',   side:'R', idx:12, port:'C', bit:6},
  {num:27, name:'PC5',   side:'R', idx:13, port:'C', bit:5},
  {num:26, name:'PC4',   side:'R', idx:14, port:'C', bit:4},
  {num:25, name:'PC3',   side:'R', idx:15, port:'C', bit:3},
  {num:24, name:'PC2',   side:'R', idx:16, port:'C', bit:2},
  {num:23, name:'PC1',   side:'R', idx:17, port:'C', bit:1},
  {num:22, name:'PC0',   side:'R', idx:18, port:'C', bit:0},
  {num:21, name:'PD7',   side:'R', idx:19, port:'D', bit:7},
];

function pinColor(port, bit) {
  if (!port) { return '#555'; }
  // Always read from portState — DOM only exists for the active tab
  var saved = portState[port] && portState[port][bit];
  if (!saved) { return '#666'; }
  if (saved.dir === 'out' && saved.state === '1') { return '#4ec94e'; }
  if (saved.dir === 'out' && saved.state === '0') { return '#FF8C42'; }
  if (saved.dir === 'in'  && saved.state === 'P') { return '#4A9EFF'; }
  return '#666'; // in/tristate
}

// ── Port table ────────────────────────────────────────────────────────────────

var activePort = 'A';

// portState is the single source of truth for all pin configurations.
// The DOM is just a view of it — rebuilt on tab switch by reading from here.
var portState = (function() {
  var s = {};
  ['A','B','C','D'].forEach(function(p) {
    s[p] = [];
    for (var i = 0; i < 8; i++) {
      s[p][i] = {dir: 'in', state: 'T'};
    }
  });
  return s;
})();

function buildPortUI() {
  var tabsEl = g('port-tabs');
  if (tabsEl) {
    tabsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('.port-tab');
      if (!btn) { return; }
      // Save current tab's DOM values back to portState before switching
      saveTabToState(activePort);
      activePort = btn.dataset.port;
      document.querySelectorAll('.port-tab').forEach(function(t) { t.classList.remove('active'); });
      btn.classList.add('active');
      renderPortTable(activePort);
    });
  }
  renderPortTable('A');
  buildSchematic();
}

// Flush the current tab's DOM selects into portState
function saveTabToState(port) {
  for (var bit = 0; bit < 8; bit++) {
    var dirEl   = g('pin-' + port + '-' + bit + '-dir');
    var stateEl = g('pin-' + port + '-' + bit + '-state');
    if (dirEl && stateEl) {
      portState[port][bit].dir   = dirEl.value;
      portState[port][bit].state = stateEl.value;
    }
  }
}

function renderPortTable(port) {
  var container = g('port-table-container');
  if (!container) { return; }
  while (container.firstChild) { container.removeChild(container.firstChild); }

  var table = document.createElement('table');
  table.className = 'pin-table';

  var thead = document.createElement('thead');
  var hrow  = document.createElement('tr');
  ['Bit', 'Direction', 'State'].forEach(function(label) {
    var th = document.createElement('th'); th.textContent = label; hrow.appendChild(th);
  });
  thead.appendChild(hrow); table.appendChild(thead);

  var tbody = document.createElement('tbody');
  for (var bit = 0; bit < 8; bit++) {
    var row = document.createElement('tr');

    // Bit label
    var tdBit = document.createElement('td');
    tdBit.className = 'bit-label';
    tdBit.textContent = 'Bit ' + bit;
    row.appendChild(tdBit);

    // Direction select — restore from portState
    var saved  = portState[port][bit];
    var dirSel = document.createElement('select');
    dirSel.id = 'pin-' + port + '-' + bit + '-dir';
    dirSel.className = 'dir-sel';
    dirSel.dataset.action = 'update';
    [['in','In'], ['out','Out']].forEach(function(pair) {
      var opt = document.createElement('option');
      opt.value = pair[0]; opt.textContent = pair[1];
      if (pair[0] === saved.dir) { opt.selected = true; }
      dirSel.appendChild(opt);
    });
    var tdDir = document.createElement('td'); tdDir.appendChild(dirSel); row.appendChild(tdDir);

    // State select — restore from portState
    var stateSel = document.createElement('select');
    stateSel.id = 'pin-' + port + '-' + bit + '-state';
    stateSel.className = 'state-sel';
    stateSel.dataset.action = 'update';
    populateStateOptions(stateSel, saved.dir, saved.state);

    // When direction changes, repopulate state options and persist to portState
    dirSel.addEventListener('change', (function(ds, ss, p, b) {
      return function() {
        var newDir = ds.value;
        var newState = newDir === 'out' ? '0' : 'T';
        populateStateOptions(ss, newDir, newState);
        portState[p][b].dir   = newDir;
        portState[p][b].state = newState;
        updateSchematic();
      };
    })(dirSel, stateSel, port, bit));

    stateSel.addEventListener('change', (function(ss, p, b) {
      return function() {
        portState[p][b].state = ss.value;
        updateSchematic();
      };
    })(stateSel, port, bit));

    var tdState = document.createElement('td'); tdState.appendChild(stateSel); row.appendChild(tdState);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function populateStateOptions(sel, dir, selectedVal) {
  while (sel.firstChild) { sel.removeChild(sel.firstChild); }
  var opts = dir === 'out'
    ? [['0','0  (Low)'], ['1','1  (High)']]
    : [['T','T  (Tristate)'], ['P','P  (Pullup)']];
  opts.forEach(function(pair) {
    var opt = document.createElement('option');
    opt.value = pair[0]; opt.textContent = pair[1];
    if (selectedVal !== undefined && pair[0] === selectedVal) { opt.selected = true; }
    sel.appendChild(opt);
  });
}

// ── ATmega32A schematic ───────────────────────────────────────────────────────

var SVG_NS = 'http://www.w3.org/2000/svg';
var PIN_STEP = 14; // px between pins
var PIN_Y0   = 22; // y of first pin
var BODY_X1  = 72;
var BODY_X2  = 168;
var STUB_LEN = 18;

function buildSchematic() {
  var container = g('schematic-container');
  if (!container) { return; }
  while (container.firstChild) { container.removeChild(container.firstChild); }

  var svgH = PIN_Y0 * 2 + 19 * PIN_STEP; // 20 pins each side
  var svgW = 280;
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
  svg.setAttribute('width',  svgW);
  svg.setAttribute('height', svgH);
  svg.id = 'chip-svg';

  // Chip body
  var body = document.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', BODY_X1); body.setAttribute('y', 8);
  body.setAttribute('width', BODY_X2 - BODY_X1);
  body.setAttribute('height', svgH - 16);
  body.setAttribute('rx', '4');
  body.setAttribute('fill', '#2a2a2a');
  body.setAttribute('stroke', '#555');
  body.setAttribute('stroke-width', '1.5');
  svg.appendChild(body);

  // Notch (pin-1 indicator)
  var notch = document.createElementNS(SVG_NS, 'path');
  var cx = (BODY_X1 + BODY_X2) / 2;
  notch.setAttribute('d', 'M' + (cx-10) + ',8 A10,10 0 0,0 ' + (cx+10) + ',8');
  notch.setAttribute('fill', '#1a1a1a');
  notch.setAttribute('stroke', '#555');
  notch.setAttribute('stroke-width', '1.5');
  svg.appendChild(notch);

  // "ATmega32A" label inside chip
  var chipLabel = document.createElementNS(SVG_NS, 'text');
  chipLabel.setAttribute('x', (BODY_X1 + BODY_X2) / 2);
  chipLabel.setAttribute('y', svgH / 2 - 6);
  chipLabel.setAttribute('text-anchor', 'middle');
  chipLabel.setAttribute('font-size', '9');
  chipLabel.setAttribute('fill', '#aaa');
  chipLabel.setAttribute('font-family', 'monospace');
  chipLabel.textContent = 'ATmega32A';
  svg.appendChild(chipLabel);
  var chipLabel2 = document.createElementNS(SVG_NS, 'text');
  chipLabel2.setAttribute('x', (BODY_X1 + BODY_X2) / 2);
  chipLabel2.setAttribute('y', svgH / 2 + 8);
  chipLabel2.setAttribute('text-anchor', 'middle');
  chipLabel2.setAttribute('font-size', '8');
  chipLabel2.setAttribute('fill', '#777');
  chipLabel2.setAttribute('font-family', 'monospace');
  chipLabel2.textContent = 'DIP-40';
  svg.appendChild(chipLabel2);

  // Draw each pin
  MEGA32_PINS.forEach(function(pin) {
    var y = PIN_Y0 + pin.idx * PIN_STEP;
    var isLeft = pin.side === 'L';
    var x1 = isLeft ? BODY_X1 : BODY_X2;
    var x2 = isLeft ? BODY_X1 - STUB_LEN : BODY_X2 + STUB_LEN;

    // Pin stub line
    var line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y);
    line.setAttribute('x2', x2); line.setAttribute('y2', y);
    line.setAttribute('stroke-width', '1.5');
    if (pin.port) {
      line.id = 'schpin-' + pin.port + '-' + pin.bit;
      line.setAttribute('stroke', pinColor(pin.port, pin.bit));
    } else {
      line.setAttribute('stroke', '#555');
    }
    svg.appendChild(line);

    // Pin dot at tip
    var dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x2); dot.setAttribute('cy', y); dot.setAttribute('r', '2.5');
    if (pin.port) {
      dot.id = 'schpin-dot-' + pin.port + '-' + pin.bit;
      dot.setAttribute('fill', pinColor(pin.port, pin.bit));
    } else {
      dot.setAttribute('fill', '#555');
    }
    svg.appendChild(dot);

    // Pin number (inside chip body edge)
    var numText = document.createElementNS(SVG_NS, 'text');
    numText.setAttribute('x', isLeft ? BODY_X1 + 5 : BODY_X2 - 5);
    numText.setAttribute('y', y + 3);
    numText.setAttribute('text-anchor', isLeft ? 'start' : 'end');
    numText.setAttribute('font-size', '7');
    numText.setAttribute('fill', '#888');
    numText.setAttribute('font-family', 'monospace');
    numText.textContent = pin.num;
    svg.appendChild(numText);

    // Pin name (outside chip body)
    var nameText = document.createElementNS(SVG_NS, 'text');
    nameText.setAttribute('x', isLeft ? x2 - 4 : x2 + 4);
    nameText.setAttribute('y', y + 3);
    nameText.setAttribute('text-anchor', isLeft ? 'end' : 'start');
    nameText.setAttribute('font-size', '8');
    nameText.setAttribute('font-family', 'monospace');
    nameText.setAttribute('font-weight', pin.port ? '600' : 'normal');
    if (pin.port) {
      nameText.id = 'schpin-name-' + pin.port + '-' + pin.bit;
      nameText.setAttribute('fill', pinColor(pin.port, pin.bit));
    } else {
      nameText.setAttribute('fill', '#666');
    }
    nameText.textContent = pin.name;
    svg.appendChild(nameText);
  });

  container.appendChild(svg);
}

function updateSchematic() {
  MEGA32_PINS.forEach(function(pin) {
    if (!pin.port) { return; }
    var color = pinColor(pin.port, pin.bit);
    var lineEl = g('schpin-' + pin.port + '-' + pin.bit);
    var dotEl  = g('schpin-dot-' + pin.port + '-' + pin.bit);
    var nameEl = g('schpin-name-' + pin.port + '-' + pin.bit);
    if (lineEl) { lineEl.setAttribute('stroke', color); }
    if (dotEl)  { dotEl.setAttribute('fill', color); }
    if (nameEl) { nameEl.setAttribute('fill', color); }
  });
}

function g(id) { return document.getElementById(id); }

function updateClockDisplay() {
  var raw = g('clockHz').value.trim();
  var hz = parseInt(raw, 10);
  var display = g('clock-mhz-display');
  if (!display) { return; }
  if (!isNaN(hz) && hz > 0) {
    display.textContent = '= ' + (hz / 1000000).toFixed(4) + ' MHz';
    display.style.color = '';
  } else {
    display.textContent = 'invalid — enter frequency in Hz';
    display.style.color = '#FF8C42';
  }
}

function buildConfig() {
  var raw = g('clockHz').value.trim();
  var clockHz = parseInt(raw, 10);
  if (isNaN(clockHz) || clockHz <= 0) { clockHz = 11059200; } // fallback

  var ports = {};
  ['A','B','C','D'].forEach(function(p) {
    var pins = [];
    for (var i = 0; i < 8; i++) {
      var dirEl   = g('pin-' + p + '-' + i + '-dir');
      var stateEl = g('pin-' + p + '-' + i + '-state');
      var dir   = dirEl   ? dirEl.value   : 'in';
      var state = stateEl ? stateEl.value : 'T';
      if      (dir === 'out' && state === '0') { pins[i] = {mode:'out', state:'low'     }; }
      else if (dir === 'out' && state === '1') { pins[i] = {mode:'out', state:'high'    }; }
      else if (dir === 'in'  && state === 'P') { pins[i] = {mode:'in',  state:'pullup'  }; }
      else                                     { pins[i] = {mode:'in',  state:'tristate'}; }
    }
    ports[p] = pins;
  });
  var config = {chip:'atmega32a', clockHz:clockHz, ports:ports};
  if (g('usart-enabled').checked) {
    var params = g('usart-params').value.split(',');
    config.usart = {baudRate:parseInt(g('usart-baud').value,10), dataBits:parseInt(params[0],10),
      stopBits:parseInt(params[1],10), parity:params[2], mode:g('usart-mode').value,
      receiver:g('usart-rx').checked, transmitter:g('usart-tx').checked,
      rxInterrupt:g('usart-rxint').checked, txInterrupt:g('usart-txint').checked};
  }
  if (g('adc-enabled').checked) {
    config.adc = {enabled:true, use8bit:g('adc-8bit').checked, interrupt:g('adc-interrupt').checked,
      noiseCanceler:g('adc-noise').checked, voltRef:g('adc-vref').value,
      clockKHz:parseInt(g('adc-clock').value,10), triggerSource:g('adc-trigger').value};
  }
  if (g('t0-enabled').checked) {
    config.timer0 = {mode:g('t0-mode').value, prescaler:g('t0-prescaler').value,
      overflowInterrupt:g('t0-ovf').checked, compareInterrupt:g('t0-cmp').checked};
  }
  if (g('t1-enabled').checked) {
    config.timer1 = {mode:'normal', prescaler:g('t1-prescaler').value,
      overflowInterrupt:g('t1-ovf').checked, compareAInterrupt:g('t1-cmpa').checked,
      compareBInterrupt:g('t1-cmpb').checked, captureInterrupt:g('t1-cap').checked};
  }
  if (g('t2-enabled').checked) {
    config.timer2 = {mode:g('t2-mode').value, prescaler:g('t2-prescaler').value,
      overflowInterrupt:g('t2-ovf').checked, compareInterrupt:g('t2-cmp').checked,
      asynchronous:g('t2-async').checked};
  }
  if (g('spi-enabled').checked) {
    config.spi = {enabled:true, mode:g('spi-mode').value, clockRate:g('spi-clock').value,
      clockPolarity:parseInt(g('spi-cpol').value,10), clockPhase:parseInt(g('spi-cpha').value,10),
      dataOrder:g('spi-order').value, interrupt:g('spi-interrupt').checked};
  }
  if (g('i2c-enabled').checked) {
    config.i2c = {enabled:true, bitRateKHz:parseInt(g('i2c-bitrate').value,10),
      slaveAddress:parseInt(g('i2c-addr').value,16)||0,
      generalCallRecognition:g('i2c-gcr').checked, interrupt:g('i2c-interrupt').checked};
  }
  var int0en=g('int0-enabled').checked, int1en=g('int1-enabled').checked, int2en=g('int2-enabled').checked;
  if (int0en||int1en||int2en) {
    config.externalInterrupts = {};
    if (int0en) { config.externalInterrupts.int0 = {enabled:true, trigger:g('int0-trigger').value}; }
    if (int1en) { config.externalInterrupts.int1 = {enabled:true, trigger:g('int1-trigger').value}; }
    if (int2en) { config.externalInterrupts.int2 = {enabled:true, trigger:g('int2-trigger').value}; }
  }
  return config;
}

function buildMeta() {
  return {project:g('meta-project').value, version:g('meta-version').value,
    author:g('meta-author').value, company:g('meta-company').value,
    comments:g('meta-comments').value};
}

function generate() {
  g('hint').textContent = 'Generating...';
  vscode.postMessage({command:'generate', config:buildConfig(), meta:buildMeta()});
}

function saveToFile() {
  if (!lastCode) { return; }
  vscode.postMessage({command:'saveToFile', code:lastCode});
}

function createProject() {
  if (!lastCode) { return; }
  vscode.postMessage({command:'createProject', code:lastCode});
}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg.command === 'codeReady') {
    lastCode = msg.code;
    // textContent — never innerHTML for dynamic data
    g('code-preview').textContent = msg.code;
    g('btn-save').disabled = false;
    g('btn-create-project').disabled = false;
    g('hint').textContent = 'Done. Click Save main.c or Create Project.';
  }
});

buildPortUI();
</script>
</body>
</html>`;
  }

  public dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    WizardPanel.currentPanel = undefined;
    this._panel.dispose();
    // Skill pattern: while-pop drain is safe even if a dispose call modifies the array
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}