import * as vscode from "vscode";
import * as crypto from "crypto";
import { generateCode } from "crystal-11-core";
import { WizardConfig } from "crystal-11-core/types";
import { isSafePath } from "./utils/validate";

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
    await vscode.workspace.fs.writeFile(uri, Buffer.from(code, "utf-8"));

    vscode.window.showInformationMessage(
      `crystal-11: Saved to ${uri.path.split("/").pop()}`
    );

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
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
      <label>Clock Frequency (MHz)</label>
      <select id="clockHz" data-action="update">
        <option value="1000000">1.000000 MHz</option>
        <option value="4000000">4.000000 MHz</option>
        <option value="8000000">8.000000 MHz</option>
        <option value="11059200" selected>11.059200 MHz</option>
        <option value="12000000">12.000000 MHz</option>
        <option value="14745600">14.745600 MHz</option>
        <option value="16000000">16.000000 MHz</option>
        <option value="20000000">20.000000 MHz</option>
      </select>
    </div>
  </div>

  <div class="panel" id="panel-ports">
    <h2>I/O Ports</h2>
    <p class="hint-text">Configure each pin: In (input), Out (output), PU (input with pull-up)</p>
    <div class="pin-grid" id="pin-grid"></div>
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
}

// Pin grid — DOM API only, no innerHTML with dynamic data
function buildPinGrid() {
  var grid = document.getElementById('pin-grid');
  if (!grid) { return; }
  while (grid.firstChild) { grid.removeChild(grid.firstChild); }
  var ports = ['A','B','C','D'];
  var emptyH = document.createElement('div'); emptyH.className = 'header'; grid.appendChild(emptyH);
  for (var i = 7; i >= 0; i--) {
    var h = document.createElement('div'); h.className = 'header';
    h.textContent = 'Bit' + i; grid.appendChild(h);
  }
  ports.forEach(function(p) {
    var lbl = document.createElement('div'); lbl.className = 'port-label';
    lbl.textContent = 'PORT' + p; grid.appendChild(lbl);
    for (var i = 7; i >= 0; i--) {
      var sel = document.createElement('select');
      sel.id = 'pin-' + p + '-' + i;
      sel.dataset.action = 'update';
      [['in_tri','In'],['in_pu','PU'],['out_lo','Out 0'],['out_hi','Out 1']].forEach(function(pair) {
        var opt = document.createElement('option');
        opt.value = pair[0]; opt.textContent = pair[1]; sel.appendChild(opt);
      });
      grid.appendChild(sel);
    }
  });
}

function g(id) { return document.getElementById(id); }

function buildConfig() {
  var clockHz = parseInt(g('clockHz').value, 10);
  var ports = {};
  ['A','B','C','D'].forEach(function(p) {
    var pins = [];
    for (var i = 0; i < 8; i++) {
      var el = g('pin-' + p + '-' + i);
      var val = el ? el.value : 'in_tri';
      if      (val === 'in_tri') { pins[i] = {mode:'in',  state:'tristate'}; }
      else if (val === 'in_pu')  { pins[i] = {mode:'in',  state:'pullup'  }; }
      else if (val === 'out_lo') { pins[i] = {mode:'out', state:'low'     }; }
      else                       { pins[i] = {mode:'out', state:'high'    }; }
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

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg.command === 'codeReady') {
    lastCode = msg.code;
    // textContent — never innerHTML for dynamic data
    g('code-preview').textContent = msg.code;
    g('btn-save').disabled = false;
    g('hint').textContent = 'Done. Click Save main.c to write to disk.';
  }
});

buildPinGrid();
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
