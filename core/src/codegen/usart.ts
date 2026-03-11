import { USARTConfig } from "../types";

function calcUBRR(clockHz: number, baud: number, u2x: boolean): number {
  if (u2x) return Math.round(clockHz / (8 * baud)) - 1;
  return Math.round(clockHz / (16 * baud)) - 1;
}

function ucsrcBits(config: USARTConfig): string {
  const umsel = config.mode === "async" ? 0 : 1;
  const upm = config.parity === "none" ? 0 : config.parity === "even" ? 2 : 3;
  const upm1 = (upm >> 1) & 1;
  const upm0 = upm & 1;
  const usbs = config.stopBits === 2 ? 1 : 0;
  const ucsz1 = config.dataBits >= 7 ? 1 : 0;
  const ucsz0 = (config.dataBits === 6 || config.dataBits === 8 || config.dataBits === 9) ? 1 : 0;
  const ucpol = (config.mode !== "async") ? 1 : 0;

  return `(1<<URSEL) | (${umsel}<<UMSEL) | (${upm1}<<UPM1) | (${upm0}<<UPM0) | (${usbs}<<USBS) | (${ucsz1}<<UCSZ1) | (${ucsz0}<<UCSZ0) | (${ucpol}<<UCPOL)`;
}

function generateRxBuffer(): string {
  return `#define DATA_REGISTER_EMPTY (1<<UDRE)
#define RX_COMPLETE (1<<RXC)
#define FRAMING_ERROR (1<<FE)
#define PARITY_ERROR (1<<UPE)
#define DATA_OVERRUN (1<<DOR)

// USART Receiver buffer
#define RX_BUFFER_SIZE 8
char rx_buffer[RX_BUFFER_SIZE];

#if RX_BUFFER_SIZE <= 256
unsigned char rx_wr_index=0,rx_rd_index=0;
#else
unsigned int rx_wr_index=0,rx_rd_index=0;
#endif

#if RX_BUFFER_SIZE < 256
unsigned char rx_counter=0;
#else
unsigned int rx_counter=0;
#endif

// This flag is set on USART Receiver buffer overflow
bit rx_buffer_overflow;

// USART Receiver interrupt service routine
interrupt [USART_RXC] void usart_rx_isr(void)
{
char status,data;
status=UCSRA;
data=UDR;
if ((status & (FRAMING_ERROR | PARITY_ERROR | DATA_OVERRUN))==0)
   {
   rx_buffer[rx_wr_index++]=data;
#if RX_BUFFER_SIZE == 256
   if (++rx_counter == 0) rx_buffer_overflow=1;
#else
   if (rx_wr_index == RX_BUFFER_SIZE) rx_wr_index=0;
   if (++rx_counter == RX_BUFFER_SIZE)
      {
      rx_counter=0;
      rx_buffer_overflow=1;
      }
#endif
   }
}

#ifndef _DEBUG_TERMINAL_IO_
#define _ALTERNATE_GETCHAR_
#pragma used+
char getchar(void)
{
char data;
while (rx_counter==0);
data=rx_buffer[rx_rd_index++];
#if RX_BUFFER_SIZE != 256
if (rx_rd_index == RX_BUFFER_SIZE) rx_rd_index=0;
#endif
#asm("cli")
--rx_counter;
#asm("sei")
return data;
}
#pragma used-
#endif`;
}

function generateTxBuffer(): string {
  return `// USART Transmitter buffer
#define TX_BUFFER_SIZE 8
char tx_buffer[TX_BUFFER_SIZE];

#if TX_BUFFER_SIZE <= 256
unsigned char tx_wr_index=0,tx_rd_index=0;
#else
unsigned int tx_wr_index=0,tx_rd_index=0;
#endif

#if TX_BUFFER_SIZE < 256
unsigned char tx_counter=0;
#else
unsigned int tx_counter=0;
#endif

// USART Transmitter interrupt service routine
interrupt [USART_TXC] void usart_tx_isr(void)
{
if (tx_counter)
   {
   --tx_counter;
   UDR=tx_buffer[tx_rd_index++];
#if TX_BUFFER_SIZE != 256
   if (tx_rd_index == TX_BUFFER_SIZE) tx_rd_index=0;
#endif
   }
}

#ifndef _DEBUG_TERMINAL_IO_
#define _ALTERNATE_PUTCHAR_
#pragma used+
void putchar(char c)
{
while (tx_counter == TX_BUFFER_SIZE);
#asm("cli")
if (tx_counter || ((UCSRA & DATA_REGISTER_EMPTY)==0))
   {
   tx_buffer[tx_wr_index++]=c;
#if TX_BUFFER_SIZE != 256
   if (tx_wr_index == TX_BUFFER_SIZE) tx_wr_index=0;
#endif
   ++tx_counter;
   }
else
   UDR=c;
#asm("sei")
}
#pragma used-
#endif`;
}

export function generateUSARTPreamble(config: USARTConfig): string {
  const parts: string[] = [];
  if (config.rxInterrupt) parts.push(generateRxBuffer());
  if (config.txInterrupt) parts.push(generateTxBuffer());
  if (!config.rxInterrupt && (config.receiver || config.transmitter)) {
    parts.push(`// Standard Input/Output functions\n#include <stdio.h>`);
  }
  if (config.rxInterrupt || config.txInterrupt) {
    parts.push(`// Standard Input/Output functions\n#include <stdio.h>`);
  }
  return parts.join("\n\n");
}

export function generateUSARTInit(config: USARTConfig, clockHz: number): string {
  const ubrr = calcUBRR(clockHz, config.baudRate, false);
  const ubrrh = (ubrr >> 8) & 0xFF;
  const ubrrl = ubrr & 0xFF;

  const rxcie = config.rxInterrupt ? 1 : 0;
  const txcie = config.txInterrupt ? 1 : 0;
  const rxen = config.receiver ? 1 : 0;
  const txen = config.transmitter ? 1 : 0;
  const ucsz2 = config.dataBits === 9 ? 1 : 0;

  const modeStr = config.mode === "async" ? "Asynchronous" : "Synchronous";
  const parityStr = config.parity === "none" ? "No Parity" : config.parity === "even" ? "Even Parity" : "Odd Parity";

  return [
    `// USART initialization`,
    `// Communication Parameters: ${config.dataBits} Data, ${config.stopBits} Stop, ${parityStr}`,
    `// USART Receiver: ${config.receiver ? "On" : "Off"}`,
    `// USART Transmitter: ${config.transmitter ? "On" : "Off"}`,
    `// USART Mode: ${modeStr}`,
    `// USART Baud Rate: ${config.baudRate}`,
    `UCSRA=(0<<RXC) | (0<<TXC) | (0<<UDRE) | (0<<FE) | (0<<DOR) | (0<<UPE) | (0<<U2X) | (0<<MPCM);`,
    `UCSRB=(${rxcie}<<RXCIE) | (${txcie}<<TXCIE) | (0<<UDRIE) | (${rxen}<<RXEN) | (${txen}<<TXEN) | (${ucsz2}<<UCSZ2) | (0<<RXB8) | (0<<TXB8);`,
    `UCSRC=${ucsrcBits(config)};`,
    `UBRRH=0x${ubrrh.toString(16).padStart(2, "0")};`,
    `UBRRL=0x${ubrrl.toString(16).padStart(2, "0")};`,
  ].join("\n");
}
