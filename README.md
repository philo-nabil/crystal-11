# crystal-11

> AVR peripheral wizard for VS Code and CLion.
> Named after 11.0592 MHz — the crystal frequency every AVR developer
> knows by heart, because it's the only one that gives you 0% baud
> rate error on standard serial communication.

---

## Why does this exist?

CodeVision AVR has a code wizard that generates peripheral init code for AVR microcontrollers.
It works. It also looks like it was designed in 2003 and never updated, runs only on Windows,
costs money, and locks you into its own IDE.

crystal-11 does the same thing — generates clean C init code for the ATmega32A — but lives
inside the tools you already use. Configure your peripherals through a proper UI, get your
`main.c` instantly, flash straight from the editor.

No CodeVision. No Windows requirement. No license fee.

---

## What it does

- Peripheral init wizard (GPIO, USART, ADC, Timers, SPI, I2C, External Interrupts)
- Generates C init code laid out like CodeVision's, but for avr-gcc + avr-libc (`<avr/io.h>`, `ISR()`), so it builds with the free toolchain
- ISP flash integration via avrdude — flash directly from VS Code or CLion
- Currently targets the ATmega32A

---

## Project structure

```
crystal-11/
├── core/                    # Shared codegen logic (TypeScript)
│   └── src/
│       ├── types.ts         # Config interfaces for all peripherals
│       ├── index.ts         # Main assembler — produces final main.c
│       └── codegen/
│           ├── gpio.ts
│           ├── usart.ts
│           ├── adc.ts
│           ├── timers.ts
│           ├── spi_i2c.ts
│           └── interrupts.ts
│
├── vscode-extension/        # VS Code extension (TypeScript + HTML)
├── clion-plugin/            # CLion plugin (Kotlin)
└── docs/
```

---

## Tech stack

| Part | Language |
|---|---|
| Core codegen | TypeScript |
| VS Code extension | TypeScript |
| Wizard UI (webview) | HTML + JavaScript |
| CLion plugin | Kotlin |
| Flash integration | TypeScript (avrdude wrapper) |

---

## Supported peripherals

- GPIO — all 4 ports, input/output/pullup per pin
- USART — async/sync, all baud rates, interrupt-driven ring buffer
- ADC — 8/10 bit, all voltage references, all trigger sources, noise canceler
- Timer0 / Timer1 / Timer2 — all modes, all prescalers
- SPI — master/slave, all clock rates and modes
- I2C (TWI) — configurable bit rate, slave address, interrupt
- External Interrupts — INT0, INT1, INT2, all trigger modes

---

## Flash integration

Uses avrdude under the hood. Supports common ISP programmers:

```bash
# USBasp
avrdude -p m32 -c usbasp -P usb -U flash:w:output.hex:i

# AVRISP mkII
avrdude -p m32 -c avrispmkII -P usb -U flash:w:output.hex:i

# Arduino as ISP
avrdude -p m32 -c arduino -P COM3 -b 19200 -U flash:w:output.hex:i
```

---

## Status

| Component | Status |
|---|---|
| Core codegen | working (ATmega32A) |
| VS Code extension | working — see `vscode-extension/` |
| CLion plugin | planned |
| Flash integration | working (avrdude, VS Code) |

---

## Why ATmega32A?

It's what we had. More chips coming later.

---

## License

MIT
