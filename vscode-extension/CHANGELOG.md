# Changelog

## 0.2.0

- Generated code now targets avr-gcc + avr-libc (`<avr/io.h>`, `ISR()`, `sei()`), so new projects build out of the box
- Automatic toolchain detection: PATH, Homebrew (Intel & Apple Silicon), apt/dnf/pacman, Arduino IDE 1.x/2.x, Microchip Studio, WinAVR, Scoop
- Projects repair their own config when opened on another computer or after installing avr-gcc
- Build task works on Windows (no shell, paths with spaces OK); IntelliSense config no longer reports errors
- avrdude is found automatically for flashing (new `crystal11.avrdudePath` setting to override); flashing no longer runs avrdude twice
- Fixes: timer interrupts overwriting each other, ISRs placed inside `main()`, missing `sei()`, Timer 2 register names, 10-bit ADC interrupt result, USART sync baud rate, ports on inactive tabs being reset, Timer 1 mode selection, F_CPU ignoring the configured clock

## 0.1.0

- Initial Marketplace release
- ATmega32A peripheral wizard (GPIO, USART, ADC, timers, SPI, I2C, external interrupts)
- Generate `main.c` and create a VS Code AVR project
- avr-gcc auto-detect and install guidance
- Flash `.hex` files with avrdude
