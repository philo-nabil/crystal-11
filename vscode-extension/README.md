# crystal-11 AVR Wizard

Generates peripheral init code for the **ATmega32A** from a settings form in VS Code.

Pick your settings for GPIO, USART, ADC, timers, SPI, I2C and external interrupts, click **Generate**, and you get a `main.c` that builds with avr-gcc. You can save the file, or create a project folder that's ready to build and flash.

Named after 11.0592 MHz, the crystal that gives 0% error at standard UART baud rates.

## Features

- Wizard pages for GPIO, USART, ADC, Timer 0/1/2, SPI, I2C (TWI) and INT0/INT1/INT2
- Generates avr-gcc / avr-libc C code for the ATmega32A at any clock (default 11.0592 MHz)
- **Create Project** makes a folder with `main.c`, C/C++ IntelliSense settings and a build task (Ctrl/Cmd+Shift+B builds `main.hex`)
- Flash a `.hex` with avrdude (USBasp, AVRISP mkII, Arduino as ISP, STK500)
- Finds `avr-gcc` and `avrdude` by itself: PATH, Homebrew, apt, Arduino IDE, Microchip Studio, WinAVR or Scoop. If you open a project on a different computer, it updates the project's toolchain paths for you.

## Getting started

1. Install the extension.
2. Open the **crystal-11 AVR Wizard** view in the Activity Bar, or run **crystal-11: Open AVR Code Wizard** from the Command Palette.
3. Turn on the peripherals you need, click **Generate Code**, then **Create Project** or **Save main.c**.

To flash, right-click a `.hex` file and choose **crystal-11: Flash to Device**, or run that command from the Command Palette.

## Commands

| Command | What it does |
|---|---|
| `crystal-11: Open AVR Code Wizard` | Opens the wizard |
| `crystal-11: Check avr-gcc Installation` | Shows where avr-gcc and avrdude were found, or how to install them |
| `crystal-11: Flash to Device` | Programs a `.hex` with avrdude |

## Settings

All settings are optional. Leave the paths empty and the extension finds the tools itself.

| Setting | Default | Description |
|---|---|---|
| `crystal11.avrGccPath` | *(empty)* | Path to `avr-gcc` |
| `crystal11.avrdudePath` | *(empty)* | Path to `avrdude` |
| `crystal11.programmer` | `usbasp` | ISP programmer type |
| `crystal11.avrdudePort` | `usb` | avrdude port (`usb`, `COM3`, `/dev/ttyUSB0`, …) |
| `crystal11.avrdudeExtra` | *(empty)* | Extra avrdude flags |

## Requirements

- **avr-gcc** to build the generated code
- **avrdude** to flash

The easiest way to get both on Windows, macOS or Linux is to install the [Arduino IDE](https://www.arduino.cc/en/software). crystal-11 finds the tools it installs. **crystal-11: Check avr-gcc Installation** shows other options for your OS. The wizard can still generate code without these tools.

## Limitations

- ATmega32A only.
- Compare and capture registers (OCR0, OCR1A/B, ICR1, OCR2) are set to 0. Set the values you need in your own code.
- Timer output pins (OC0, OC1A, OC1B, OC2) are left disconnected.

## License

MIT
