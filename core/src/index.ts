import { WizardConfig } from "./types";
import { generateGPIO } from "./codegen/gpio";
import { generateUSARTPreamble, generateUSARTInit } from "./codegen/usart";
import { generateADCPreamble, generateADCInit } from "./codegen/adc";
import { generateTimer0Init, generateTimer1Init, generateTimer2Init } from "./codegen/timers";
import { generateSPIInit, generateI2CInit } from "./codegen/spi_i2c";
import { generateExternalInterruptsInit } from "./codegen/interrupts";

function formatDate(): string {
  const d = new Date();
  return `${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getDate().toString().padStart(2,"0")}/${d.getFullYear()}`;
}

export function generateCode(config: WizardConfig, meta?: {
  project?: string;
  version?: string;
  author?: string;
  company?: string;
  comments?: string;
}): string {
  const m = meta ?? {};
  const clockMHz = (config.clockHz / 1_000_000).toFixed(6);
  const needsDelay = !!config.adc?.enabled;
  const needsSei =
    config.usart?.rxInterrupt ||
    config.usart?.txInterrupt ||
    config.adc?.interrupt ||
    config.externalInterrupts?.int0?.enabled ||
    config.externalInterrupts?.int1?.enabled ||
    config.externalInterrupts?.int2?.enabled;

  const preambles: string[] = [];

  // USART preamble (ring buffers etc)
  if (config.usart) {
    const p = generateUSARTPreamble(config.usart);
    if (p) preambles.push(p);
  }

  // ADC preamble (read_adc function)
  if (config.adc?.enabled) {
    const p = generateADCPreamble(config.adc);
    if (p) preambles.push(p);
  }

  // External interrupt ISRs
  if (config.externalInterrupts) {
    const p = generateExternalInterruptsInit(config.externalInterrupts);
    if (p) preambles.push(p);
  }

  // SPI ISR
  if (config.spi?.enabled && config.spi.interrupt) {
    preambles.push(`// SPI interrupt service routine
interrupt [SPI_STC] void spi_isr(void)
{
// Place your code here
}`);
  }

  // I2C ISR
  if (config.i2c?.enabled && config.i2c.interrupt) {
    preambles.push(`// Two Wire Interface interrupt service routine
interrupt [TWI_INT] void twi_isr(void)
{
// Place your code here
}`);
  }

  const initBlocks: string[] = [];

  // GPIO always present
  initBlocks.push(generateGPIO(config.ports ?? {}));

  if (config.externalInterrupts) {
    initBlocks.push(generateExternalInterruptsInit(config.externalInterrupts).split("\n\n").pop()!);
  }

  if (config.timer0) initBlocks.push(generateTimer0Init(config.timer0));
  if (config.timer1) initBlocks.push(generateTimer1Init(config.timer1));
  if (config.timer2) initBlocks.push(generateTimer2Init(config.timer2));

  if (config.usart) initBlocks.push(generateUSARTInit(config.usart, config.clockHz));
  if (config.adc?.enabled) initBlocks.push(generateADCInit(config.adc, config.clockHz));
  if (config.spi?.enabled) initBlocks.push(generateSPIInit(config.spi));
  if (config.i2c?.enabled) initBlocks.push(generateI2CInit(config.i2c, config.clockHz));

  const header = `/*******************************************************
This program was created by the
AVR Wizard
Automatic Program Generator

Project : ${m.project ?? ""}
Version : ${m.version ?? ""}
Date    : ${formatDate()}
Author  : ${m.author ?? ""}
Company : ${m.company ?? ""}
Comments: ${m.comments ?? ""}

Chip type               : ATmega32A
Program type            : Application
AVR Core Clock frequency: ${clockMHz} MHz
Memory model            : Small
External RAM size       : 0
Data Stack size         : 512
*******************************************************/`;

  const includes = [
    `#include <mega32a.h>`,
    needsDelay ? `#include <delay.h>` : null,
  ].filter(Boolean).join("\n");

  const mainBody = [
    `void main(void)\n{`,
    `// Declare your local variables here`,
    ``,
    initBlocks.join("\n\n"),
    needsSei ? `// Global enable interrupts\n#asm("sei")` : null,
    `while (1)\n      {\n      // Place your code here\n\n      }`,
    `}`,
  ].filter(x => x !== null).join("\n");

  const parts = [
    header,
    includes,
    `// Declare your global variables here`,
    preambles.length > 0 ? preambles.join("\n\n") : null,
    mainBody,
  ].filter(x => x !== null);

  return parts.join("\n");
}
