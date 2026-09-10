import { SPIConfig, I2CConfig } from "../types";

// ─── SPI ─────────────────────────────────────────────────────────────────────

const SPI_CLOCK: Record<string, { spr1: number; spr0: number; spi2x: number; label: string }> = {
  fosc_4:   { spr1: 0, spr0: 0, spi2x: 0, label: "Fosc/4"   },
  fosc_16:  { spr1: 0, spr0: 1, spi2x: 0, label: "Fosc/16"  },
  fosc_64:  { spr1: 1, spr0: 0, spi2x: 0, label: "Fosc/64"  },
  fosc_128: { spr1: 1, spr0: 1, spi2x: 0, label: "Fosc/128" },
  fosc_2:   { spr1: 0, spr0: 0, spi2x: 1, label: "Fosc/2"   },
  fosc_8:   { spr1: 0, spr0: 1, spi2x: 1, label: "Fosc/8"   },
  fosc_32:  { spr1: 1, spr0: 0, spi2x: 1, label: "Fosc/32"  },
};

export function generateSPIInit(config: SPIConfig): string {
  if (!config.enabled) return "";

  const clk = SPI_CLOCK[config.clockRate];
  const mstr = config.mode === "master" ? 1 : 0;
  const cpol = config.clockPolarity;
  const cpha = config.clockPhase;
  const dord = config.dataOrder === "lsb" ? 1 : 0;
  const spie = config.interrupt ? 1 : 0;

  const preamble = config.interrupt ? `// SPI transfer-complete handler
interrupt [SPI_STC] void spi_isr(void)
{
// Place your code here
}

` : "";

  const init = [
    `// --- SPI ---`,
    `// Role: ${config.mode === "master" ? "Master" : "Slave"}`,
    `// Clock rate: ${clk.label}`,
    `// Clock phase (CPHA): ${cpha === 0 ? "sample leading edge" : "sample trailing edge"}`,
    `// Clock idle level (CPOL): ${cpol === 0 ? "low" : "high"}`,
    `// Bit order: ${config.dataOrder === "msb" ? "MSB" : "LSB"} first`,
    `SPCR=(${spie}<<SPIE) | (1<<SPE) | (${dord}<<DORD) | (${mstr}<<MSTR) | (${cpol}<<CPOL) | (${cpha}<<CPHA) | (${clk.spr1}<<SPR1) | (${clk.spr0}<<SPR0);`,
    `SPSR=(${clk.spi2x}<<SPI2X);`,
  ].join("\n");

  return preamble + init;
}

// ─── I2C (TWI) ───────────────────────────────────────────────────────────────

export function generateI2CInit(config: I2CConfig, clockHz: number): string {
  if (!config.enabled) return "";

  // TWBR = ((F_CPU / F_SCL) - 16) / (2 * prescaler)
  // Using prescaler = 1
  const twbr = Math.round(((clockHz / (config.bitRateKHz * 1000)) - 16) / 2);
  const twbrHex = Math.max(0, Math.min(255, twbr)).toString(16).padStart(2, "0").toUpperCase();

  const slaveAddr = config.slaveAddress ?? 0;
  const gcre = config.generalCallRecognition ? 1 : 0;
  const twie = config.interrupt ? 1 : 0;

  const preamble = config.interrupt ? `// I2C (TWI) event handler
interrupt [TWI_INT] void twi_isr(void)
{
// Place your code here
}

` : "";

  const init = [
    `// --- I2C (TWI) ---`,
    `// ACK: sent automatically on received bytes`,
    `// Slave address: 0x${slaveAddr.toString(16).padStart(2, "0").toUpperCase()}`,
    `// Responds to general call: ${config.generalCallRecognition ? "yes" : "no"}`,
    `// Bus speed: ${config.bitRateKHz} kHz`,
    `TWSR=0x00;`,
    `TWAR=(0x${slaveAddr.toString(16).padStart(2, "0").toUpperCase()}<<1) | (${gcre}<<TWGCE);`,
    `TWBR=0x${twbrHex};`,
    `TWCR=(${twie}<<TWIE) | (1<<TWEN) | (0<<TWSTO) | (0<<TWSTA) | (0<<TWEA) | (0<<TWINT);`,
  ].join("\n");

  return preamble + init;
}
