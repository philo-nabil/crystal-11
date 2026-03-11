export interface WizardConfig {
  chip: "atmega32a";
  clockHz: number;
  ports?: PortConfig;
  usart?: USARTConfig;
  adc?: ADCConfig;
  timer0?: Timer0Config;
  timer1?: Timer1Config;
  timer2?: Timer2Config;
  spi?: SPIConfig;
  i2c?: I2CConfig;
  externalInterrupts?: ExternalInterruptConfig;
}

// ─── GPIO ────────────────────────────────────────────────────────────────────

export type PinMode = "in" | "out";
export type PinState = "low" | "high" | "pullup" | "tristate";

export interface PinConfig {
  mode: PinMode;
  state: PinState;
}

export interface PortConfig {
  A?: PinConfig[];  // [bit0, bit1, ..., bit7]
  B?: PinConfig[];
  C?: PinConfig[];
  D?: PinConfig[];
}

// ─── USART ───────────────────────────────────────────────────────────────────

export type USARTMode = "async" | "sync_master_cpol0" | "sync_master_cpol1" | "sync_slave_cpol0" | "sync_slave_cpol1";
export type USARTParity = "none" | "even" | "odd";
export type USARTDataBits = 5 | 6 | 7 | 8 | 9;
export type USARTStopBits = 1 | 2;

export interface USARTConfig {
  baudRate: number;
  dataBits: USARTDataBits;
  stopBits: USARTStopBits;
  parity: USARTParity;
  mode: USARTMode;
  receiver: boolean;
  transmitter: boolean;
  rxInterrupt: boolean;
  txInterrupt: boolean;
}

// ─── ADC ─────────────────────────────────────────────────────────────────────

export type ADCVoltRef = "aref" | "avcc" | "internal";
export type ADCTrigger = "stopped" | "free_running" | "analog_comparator" | "ext_irq0" | "timer0_compare" | "timer0_overflow" | "timer1_compare_b" | "timer1_overflow" | "timer1_capture";
export type ADCClock = 125 | 250 | 500 | 1000 | 2000 | 4000 | 8000; // kHz

export interface ADCConfig {
  enabled: boolean;
  use8bit: boolean;
  interrupt: boolean;
  noiseCanceler: boolean;
  voltRef: ADCVoltRef;
  clockKHz: ADCClock;
  triggerSource: ADCTrigger;
}

// ─── TIMER0 ──────────────────────────────────────────────────────────────────

export type Timer0Mode = "normal" | "ctc" | "fast_pwm" | "phase_correct_pwm";
export type Timer0Prescaler = "off" | "1" | "8" | "64" | "256" | "1024" | "ext_falling" | "ext_rising";

export interface Timer0Config {
  mode: Timer0Mode;
  prescaler: Timer0Prescaler;
  overflowInterrupt: boolean;
  compareInterrupt: boolean;
  compareValue?: number; // OCR0
}

// ─── TIMER1 ──────────────────────────────────────────────────────────────────

export type Timer1Mode = "normal" | "ctc_ocr1a" | "ctc_icr1" | "fast_pwm_8bit" | "fast_pwm_9bit" | "fast_pwm_10bit" | "fast_pwm_icr1" | "fast_pwm_ocr1a" | "phase_correct_8bit" | "phase_correct_9bit" | "phase_correct_10bit";
export type Timer1Prescaler = "off" | "1" | "8" | "64" | "256" | "1024" | "ext_falling" | "ext_rising";

export interface Timer1Config {
  mode: Timer1Mode;
  prescaler: Timer1Prescaler;
  overflowInterrupt: boolean;
  compareAInterrupt: boolean;
  compareBInterrupt: boolean;
  captureInterrupt: boolean;
  compareA?: number;
  compareB?: number;
  inputCapture?: number;
}

// ─── TIMER2 ──────────────────────────────────────────────────────────────────

export type Timer2Mode = "normal" | "ctc" | "fast_pwm" | "phase_correct_pwm";
export type Timer2Prescaler = "off" | "1" | "8" | "32" | "64" | "128" | "256" | "1024";

export interface Timer2Config {
  mode: Timer2Mode;
  prescaler: Timer2Prescaler;
  overflowInterrupt: boolean;
  compareInterrupt: boolean;
  compareValue?: number;
  asynchronous: boolean; // 32.768kHz crystal
}

// ─── SPI ─────────────────────────────────────────────────────────────────────

export type SPIMode = "master" | "slave";
export type SPIClockRate = "fosc_4" | "fosc_16" | "fosc_64" | "fosc_128" | "fosc_2" | "fosc_8" | "fosc_32";
export type SPIClockPolarity = 0 | 1;
export type SPIClockPhase = 0 | 1;
export type SPIDataOrder = "msb" | "lsb";

export interface SPIConfig {
  enabled: boolean;
  mode: SPIMode;
  clockRate: SPIClockRate;
  clockPolarity: SPIClockPolarity;
  clockPhase: SPIClockPhase;
  dataOrder: SPIDataOrder;
  interrupt: boolean;
}

// ─── I2C (TWI) ───────────────────────────────────────────────────────────────

export interface I2CConfig {
  enabled: boolean;
  bitRateKHz: number;
  slaveAddress?: number;
  generalCallRecognition: boolean;
  interrupt: boolean;
}

// ─── External Interrupts ─────────────────────────────────────────────────────

export type ExtIntTrigger = "low_level" | "any_change" | "falling" | "rising";

export interface ExternalInterruptConfig {
  int0?: { enabled: boolean; trigger: ExtIntTrigger };
  int1?: { enabled: boolean; trigger: ExtIntTrigger };
  int2?: { enabled: boolean; trigger: "falling" | "rising" };
}
