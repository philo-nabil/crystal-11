import { USARTConfig } from "../types";

function calcUBRR(clockHz: number, baud: number, divisor: number): number {
  // UBRR is 12 bits; out-of-range baud rates used to wrap or go negative.
  const ubrr = Math.round(clockHz / (divisor * baud)) - 1;
  return Math.max(0, Math.min(0x0FFF, ubrr));
}

function ucsrcBits(config: USARTConfig): string {
  const umsel = config.mode === "async" ? 0 : 1;
  const upm = config.parity === "none" ? 0 : config.parity === "even" ? 2 : 3;
  const upm1 = (upm >> 1) & 1;
  const upm0 = upm & 1;
  const usbs = config.stopBits === 2 ? 1 : 0;
  const ucsz1 = config.dataBits >= 7 ? 1 : 0;
  const ucsz0 = (config.dataBits === 6 || config.dataBits === 8 || config.dataBits === 9) ? 1 : 0;
  // UCPOL only matters in synchronous mode. The mode name's suffix
  // (cpol0/cpol1) selects the bit — previously this only checked
  // sync-vs-async, so sync_master_cpol0 and sync_slave_cpol0 incorrectly
  // got UCPOL=1 along with the cpol1 variants.
  const ucpol = config.mode.endsWith("cpol1") ? 1 : 0;

  return `(1<<URSEL) | (${umsel}<<UMSEL) | (${upm1}<<UPM1) | (${upm0}<<UPM0) | (${usbs}<<USBS) | (${ucsz1}<<UCSZ1) | (${ucsz0}<<UCSZ0) | (${ucpol}<<UCPOL)`;
}

const STATUS_DEFINES = `#define DATA_REGISTER_EMPTY (1<<UDRE)
#define RX_COMPLETE (1<<RXC)
#define FRAMING_ERROR (1<<FE)
#define PARITY_ERROR (1<<UPE)
#define DATA_OVERRUN (1<<DOR)`;

function generateRxBuffer(): string {
  return `// Receive ring buffer
#define RX_BUFFER_SIZE 8
volatile char rx_buffer[RX_BUFFER_SIZE];

#if RX_BUFFER_SIZE <= 256
volatile unsigned char rx_wr_index=0,rx_rd_index=0;
#else
volatile unsigned int rx_wr_index=0,rx_rd_index=0;
#endif

#if RX_BUFFER_SIZE < 256
volatile unsigned char rx_counter=0;
#else
volatile unsigned int rx_counter=0;
#endif

// set when a byte arrives with nowhere to go
volatile unsigned char rx_buffer_overflow=0;

// USART receive-complete handler
ISR(USART_RXC_vect)
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

// Read one byte from the receive buffer (blocks until one arrives)
static int usart_getchar(FILE *stream)
{
char data;
(void)stream;
while (rx_counter==0);
data=rx_buffer[rx_rd_index++];
#if RX_BUFFER_SIZE != 256
if (rx_rd_index == RX_BUFFER_SIZE) rx_rd_index=0;
#endif
cli();
--rx_counter;
sei();
return (unsigned char)data;
}`;
}

function generatePolledRx(): string {
  return `// Read one byte from the USART (polled, blocks until one arrives)
static int usart_getchar(FILE *stream)
{
(void)stream;
while ((UCSRA & RX_COMPLETE)==0);
return UDR;
}`;
}

function generateTxBuffer(): string {
  return `// Transmit ring buffer
#define TX_BUFFER_SIZE 8
volatile char tx_buffer[TX_BUFFER_SIZE];

#if TX_BUFFER_SIZE <= 256
volatile unsigned char tx_wr_index=0,tx_rd_index=0;
#else
volatile unsigned int tx_wr_index=0,tx_rd_index=0;
#endif

#if TX_BUFFER_SIZE < 256
volatile unsigned char tx_counter=0;
#else
volatile unsigned int tx_counter=0;
#endif

// USART transmit-complete handler — sends the next buffered byte, if any
ISR(USART_TXC_vect)
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

// Queue one byte for transmission (blocks only while the buffer is full)
static int usart_putchar(char c, FILE *stream)
{
(void)stream;
while (tx_counter == TX_BUFFER_SIZE);
cli();
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
sei();
return 0;
}`;
}

function generatePolledTx(): string {
  return `// Send one byte over the USART (polled)
static int usart_putchar(char c, FILE *stream)
{
(void)stream;
while ((UCSRA & DATA_REGISTER_EMPTY)==0);
UDR=c;
return 0;
}`;
}

// avr-libc has no built-in getchar/putchar backend: stdio goes through a
// FILE stream wired to these functions, and main() points stdin/stdout at it.
// (The old CodeVision version relied on _ALTERNATE_GETCHAR_ / #pragma used+,
// which avr-gcc doesn't understand.)
export function generateUSARTPreamble(config: USARTConfig): string {
  const parts: string[] = [STATUS_DEFINES];
  parts.push(config.rxInterrupt ? generateRxBuffer() : generatePolledRx());
  parts.push(config.txInterrupt ? generateTxBuffer() : generatePolledTx());
  parts.push(`// printf/scanf stream bound to the USART
static FILE usart_stream = FDEV_SETUP_STREAM(usart_putchar, usart_getchar, _FDEV_SETUP_RW);`);
  return parts.join("\n\n");
}

export function generateUSARTInit(config: USARTConfig, clockHz: number): string {
  // Datasheet: async normal speed is fosc/(16*BAUD), synchronous master is
  // fosc/(2*BAUD). (Slave mode ignores UBRR — the clock comes from XCK.)
  const ubrr = calcUBRR(clockHz, config.baudRate, config.mode === "async" ? 16 : 2);
  const ubrrh = (ubrr >> 8) & 0xFF;
  const ubrrl = ubrr & 0xFF;

  const rxcie = config.rxInterrupt ? 1 : 0;
  const txcie = config.txInterrupt ? 1 : 0;
  const rxen = config.receiver ? 1 : 0;
  const txen = config.transmitter ? 1 : 0;
  const ucsz2 = config.dataBits === 9 ? 1 : 0;

  const modeStr = config.mode === "async" ? "asynchronous" : "synchronous";
  const parityStr = config.parity === "none" ? "no parity" : config.parity === "even" ? "even parity" : "odd parity";

  return [
    `// --- USART ---`,
    `// Frame: ${config.dataBits} data bits, ${config.stopBits} stop bit(s), ${parityStr}`,
    `// RX: ${config.receiver ? "on" : "off"}, TX: ${config.transmitter ? "on" : "off"}`,
    `// Mode: ${modeStr}`,
    `// Baud rate: ${config.baudRate}`,
    `UCSRA=(0<<RXC) | (0<<TXC) | (0<<UDRE) | (0<<FE) | (0<<DOR) | (0<<UPE) | (0<<U2X) | (0<<MPCM);`,
    `UCSRB=(${rxcie}<<RXCIE) | (${txcie}<<TXCIE) | (0<<UDRIE) | (${rxen}<<RXEN) | (${txen}<<TXEN) | (${ucsz2}<<UCSZ2) | (0<<RXB8) | (0<<TXB8);`,
    `UCSRC=${ucsrcBits(config)};`,
    `UBRRH=0x${ubrrh.toString(16).padStart(2, "0")};`,
    `UBRRL=0x${ubrrl.toString(16).padStart(2, "0")};`,
  ].join("\n");
}
