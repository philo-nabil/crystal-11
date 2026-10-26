# crystal-11 AVR Wizard

AVR peripheral init code generator for the **ATmega32A**, inside VS Code / Cursor.

Configure GPIO, USART, ADC, timers, SPI, I2C, and external interrupts in a wizard, then generate `main.c` and optionally create a ready-to-build project. Named after 11.0592 MHz — the crystal that gives 0% baud-rate error on standard serial.

## Features

- Peripheral wizard: GPIO, USART, ADC, Timer0/1/2, SPI, I2C (TWI), INT0/INT1/INT2
- Generates avr-gcc C init code for ATmega32A at any clock (default 11.0592 MHz)
- Create a ready-to-build project: `main.c`, IntelliSense settings, and a build task (Ctrl/Cmd+Shift+B → `main.hex`)
- Flash a `.hex` via avrdude (USBasp, AVRISP mkII, Arduino as ISP, STK500)
- No configuration: finds `avr-gcc` and `avrdude` from PATH, Homebrew, apt, Arduino IDE, Microchip Studio, WinAVR or Scoop, and fixes project paths when you open a project on another computer

## Getting started

1. Install the extension.
2. Open the **crystal-11 AVR Wizard** view in the Activity Bar, or run **crystal-11: Open AVR Code Wizard** from the Command Palette.
3. Enable the peripherals you need, generate code, then **Create Project** or save to a file.

To flash: right-click a `.hex` file and choose **crystal-11: Flash to Device**, or run the command from the palette.

## Commands

| Command | What it does |
|---|---|
| `crystal-11: Open AVR Code Wizard` | Opens the peripheral wizard |
| `crystal-11: Check avr-gcc Installation` | Verifies the toolchain |
| `crystal-11: Flash to Device` | Programs a `.hex` with avrdude |

## Settings

| Setting | Default | Description |
|---|---|---|
| `crystal11.avrGccPath` | *(empty)* | Path to `avr-gcc`; leave empty to auto-detect |
| `crystal11.avrdudePath` | *(empty)* | Path to `avrdude`; leave empty to auto-detect |
| `crystal11.programmer` | `usbasp` | ISP programmer type |
| `crystal11.avrdudePort` | `usb` | avrdude port (`usb`, `COM3`, `/dev/ttyUSB0`, …) |
| `crystal11.avrdudeExtra` | *(empty)* | Extra avrdude flags |

## Requirements

- **avr-gcc** to build generated C
- **avrdude** to flash

The easiest way to get both on any OS is to install the [Arduino IDE](https://www.arduino.cc/en/software) — crystal-11 picks up its toolchain automatically. Run **crystal-11: Check avr-gcc Installation** for OS-specific instructions. The wizard still generates code without them.

## License

MIT
