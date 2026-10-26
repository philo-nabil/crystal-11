# crystal-11

A VS Code extension that generates peripheral init code for the ATmega32A.

The name comes from 11.0592 MHz, the crystal most ATmega32A courses use,
because it divides evenly into the standard UART baud rates (0% error at 9600,
115200 and so on).

---

## Why does this exist?

CodeVision AVR has a code wizard that generates peripheral init code for AVR
microcontrollers. It works, but it only runs on Windows, it costs money, and
it ties you to its own IDE.

crystal-11 gives you a similar wizard inside VS Code. You pick your peripheral
settings in a form, it writes `main.c` for you, and the code builds with the
free avr-gcc toolchain.

---

## What it does

- A wizard for GPIO, USART, ADC, Timer 0/1/2, SPI, I2C (TWI) and external
  interrupts INT0–INT2
- Generates `main.c` for avr-gcc + avr-libc, laid out like CodeVision's
  output (one commented block per peripheral)
- Creates a project folder with `main.c`, IntelliSense settings and a build
  task that produces `main.hex`
- Flashes a `.hex` with avrdude
- Finds avr-gcc and avrdude by itself (PATH, Homebrew, apt, Arduino IDE,
  Microchip Studio, WinAVR, Scoop)

Only the ATmega32A is supported.

---

## What each peripheral page lets you set

| Peripheral | Options |
|---|---|
| GPIO | Ports A–D, each pin input (tristate / pull-up) or output (low / high) |
| USART | Baud rate (1200–115200), async or sync mode, 7/8/9 data bits, parity, stop bits, RX/TX enable, interrupt-driven RX/TX ring buffers (8 bytes) |
| ADC | Voltage reference, ADC clock, auto-trigger source, 8 or 10 bit, interrupt, noise canceler |
| Timer 0 / 2 | Mode (normal, CTC, fast PWM, phase-correct PWM), prescaler, overflow and compare interrupts; Timer 2 async 32.768 kHz option |
| Timer 1 | All 11 waveform modes, prescaler, overflow / compare A / compare B / input capture interrupts |
| SPI | Master or slave, clock rate, CPOL, CPHA, bit order, interrupt |
| I2C (TWI) | Bus speed (50, 100, 200, 400 kHz), slave address, general call, interrupt |
| External interrupts | INT0 / INT1 / INT2 enable and trigger edge |

Not supported yet: setting compare / capture register values (OCR0, OCR1A/B,
ICR1, OCR2 start at 0, so set them in your own code), and driving the OC0 /
OC1A / OC1B / OC2 output pins.

---

## Project structure

```
crystal-11/
├── core/                    # Code generator (TypeScript)
│   └── src/
│       ├── types.ts         # Config types for every peripheral
│       ├── index.ts         # Builds the final main.c
│       └── codegen/         # One file per peripheral
│
└── vscode-extension/        # The VS Code extension
    └── src/
        ├── extension.ts     # Commands
        ├── wizardPanel.ts   # The wizard UI
        ├── projectConfig.ts # Writes .vscode/ files for new projects
        ├── flashCommand.ts  # avrdude wrapper
        └── utils/           # Toolchain detection
```

---

## Building from source

```bash
cd vscode-extension
npm install
npm run compile      # bundle to out/extension.js
npm run type-check
npm run lint
```

Press F5 in VS Code to run the extension in a development window.
There are no automated tests yet.

---

## Flashing

crystal-11 runs avrdude for you. These are the commands it uses for each
programmer:

```bash
# USBasp
avrdude -p m32 -c usbasp -P usb -U flash:w:main.hex:i

# AVRISP mkII
avrdude -p m32 -c avrispmkII -P usb -U flash:w:main.hex:i

# Arduino as ISP
avrdude -p m32 -c arduino -P COM3 -b 19200 -U flash:w:main.hex:i
```

---

## Status

| Component | Status |
|---|---|
| Code generator | Working (ATmega32A) |
| VS Code extension | Working, published on the VS Code Marketplace |
| Other chips | Not started |
| CLion plugin | Idea only, not started |

---

## Why ATmega32A?

It's what we had. More chips may come later.

---

## License

MIT
