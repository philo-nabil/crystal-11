import { Timer0Config, Timer1Config, Timer2Config } from "../types";

// ─── TIMER 0 ─────────────────────────────────────────────────────────────────

const T0_PRESCALER: Record<string, string> = {
  off:          "(0<<CS02) | (0<<CS01) | (0<<CS00)",
  "1":          "(0<<CS02) | (0<<CS01) | (1<<CS00)",
  "8":          "(0<<CS02) | (1<<CS01) | (0<<CS00)",
  "64":         "(0<<CS02) | (1<<CS01) | (1<<CS00)",
  "256":        "(1<<CS02) | (0<<CS01) | (0<<CS00)",
  "1024":       "(1<<CS02) | (0<<CS01) | (1<<CS00)",
  ext_falling:  "(1<<CS02) | (1<<CS01) | (0<<CS00)",
  ext_rising:   "(1<<CS02) | (1<<CS01) | (1<<CS00)",
};

const T0_MODE: Record<string, { wgm01: number; wgm00: number; label: string }> = {
  normal:             { wgm01: 0, wgm00: 0, label: "Normal top=FFh" },
  phase_correct_pwm:  { wgm01: 0, wgm00: 1, label: "Phase correct PWM top=FFh" },
  ctc:                { wgm01: 1, wgm00: 0, label: "CTC top=OCR0" },
  fast_pwm:           { wgm01: 1, wgm00: 1, label: "Fast PWM top=FFh" },
};

export function generateTimer0Init(config: Timer0Config): string {
  const mode = T0_MODE[config.mode];
  const prescaler = T0_PRESCALER[config.prescaler];
  const toie = config.overflowInterrupt ? 1 : 0;
  const ocie = config.compareInterrupt ? 1 : 0;
  const ocr = config.compareValue ?? 0;

  return [
    `// --- Timer 0 ---`,
    `// Clock: ${config.prescaler === "off" ? "stopped" : `system clock / ${config.prescaler}`}`,
    `// Waveform mode: ${mode.label}`,
    `// OC0 pin: not connected`,
    `TCCR0=(${mode.wgm00}<<WGM00) | (0<<COM01) | (0<<COM00) | (${mode.wgm01}<<WGM01) | ${prescaler};`,
    `TCNT0=0x00;`,
    `OCR0=0x${ocr.toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer 0 interrupts`,
    `TIMSK=(0<<OCIE2) | (0<<TOIE2) | (0<<TICIE1) | (0<<OCIE1A) | (0<<OCIE1B) | (0<<TOIE1) | (${ocie}<<OCIE0) | (${toie}<<TOIE0);`,
  ].join("\n");
}

// ─── TIMER 1 ─────────────────────────────────────────────────────────────────

const T1_PRESCALER: Record<string, string> = {
  off:          "(0<<CS12) | (0<<CS11) | (0<<CS10)",
  "1":          "(0<<CS12) | (0<<CS11) | (1<<CS10)",
  "8":          "(0<<CS12) | (1<<CS11) | (0<<CS10)",
  "64":         "(0<<CS12) | (1<<CS11) | (1<<CS10)",
  "256":        "(1<<CS12) | (0<<CS11) | (0<<CS10)",
  "1024":       "(1<<CS12) | (0<<CS11) | (1<<CS10)",
  ext_falling:  "(1<<CS12) | (1<<CS11) | (0<<CS10)",
  ext_rising:   "(1<<CS12) | (1<<CS11) | (1<<CS10)",
};

// WGM13:10 per ATmega32 datasheet Table 45. Previously generateTimer1Init
// never read config.mode at all — Timer1 always came out as Normal mode
// regardless of what was selected in the wizard.
const T1_MODE: Record<string, { wgm13: number; wgm12: number; wgm11: number; wgm10: number; label: string; top: string }> = {
  normal:              { wgm13: 0, wgm12: 0, wgm11: 0, wgm10: 0, label: "Normal top=FFFFh", top: "0xFFFF" },
  phase_correct_8bit:  { wgm13: 0, wgm12: 0, wgm11: 0, wgm10: 1, label: "Phase correct PWM top=00FFh", top: "0x00FF" },
  phase_correct_9bit:  { wgm13: 0, wgm12: 0, wgm11: 1, wgm10: 0, label: "Phase correct PWM top=01FFh", top: "0x01FF" },
  phase_correct_10bit: { wgm13: 0, wgm12: 0, wgm11: 1, wgm10: 1, label: "Phase correct PWM top=03FFh", top: "0x03FF" },
  ctc_ocr1a:           { wgm13: 0, wgm12: 1, wgm11: 0, wgm10: 0, label: "CTC top=OCR1A", top: "OCR1A" },
  fast_pwm_8bit:       { wgm13: 0, wgm12: 1, wgm11: 0, wgm10: 1, label: "Fast PWM top=00FFh", top: "0x00FF" },
  fast_pwm_9bit:       { wgm13: 0, wgm12: 1, wgm11: 1, wgm10: 0, label: "Fast PWM top=01FFh", top: "0x01FF" },
  fast_pwm_10bit:      { wgm13: 0, wgm12: 1, wgm11: 1, wgm10: 1, label: "Fast PWM top=03FFh", top: "0x03FF" },
  ctc_icr1:            { wgm13: 1, wgm12: 1, wgm11: 0, wgm10: 0, label: "CTC top=ICR1", top: "ICR1" },
  fast_pwm_icr1:       { wgm13: 1, wgm12: 1, wgm11: 1, wgm10: 0, label: "Fast PWM top=ICR1", top: "ICR1" },
  fast_pwm_ocr1a:      { wgm13: 1, wgm12: 1, wgm11: 1, wgm10: 1, label: "Fast PWM top=OCR1A", top: "OCR1A" },
};

export function generateTimer1Init(config: Timer1Config): string {
  const mode = T1_MODE[config.mode];
  const prescaler = T1_PRESCALER[config.prescaler];
  const toie = config.overflowInterrupt ? 1 : 0;
  const ocieA = config.compareAInterrupt ? 1 : 0;
  const ocieB = config.compareBInterrupt ? 1 : 0;
  const ticie = config.captureInterrupt ? 1 : 0;
  const ocrA = config.compareA ?? 0;
  const ocrB = config.compareB ?? 0;
  const icr = config.inputCapture ?? 0;

  return [
    `// --- Timer 1 ---`,
    `// Clock: ${config.prescaler === "off" ? "stopped" : `system clock / ${config.prescaler}`}`,
    `// Waveform mode: ${mode.label}`,
    `// OC1A / OC1B pins: not connected`,
    `// Input capture noise canceler: off, triggers on falling edge`,
    `// Overflow interrupt: ${config.overflowInterrupt ? "on" : "off"}`,
    `// Input capture interrupt: ${config.captureInterrupt ? "on" : "off"}`,
    `// Compare A interrupt: ${config.compareAInterrupt ? "on" : "off"}`,
    `// Compare B interrupt: ${config.compareBInterrupt ? "on" : "off"}`,
    `TCCR1A=(0<<COM1A1) | (0<<COM1A0) | (0<<COM1B1) | (0<<COM1B0) | (0<<FOC1A) | (0<<FOC1B) | (${mode.wgm11}<<WGM11) | (${mode.wgm10}<<WGM10);`,
    `TCCR1B=(0<<ICNC1) | (0<<ICES1) | (${mode.wgm13}<<WGM13) | (${mode.wgm12}<<WGM12) | ${prescaler};`,
    `TCNT1H=0x00;`,
    `TCNT1L=0x00;`,
    `ICR1H=0x${Math.floor(icr / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `ICR1L=0x${(icr % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1AH=0x${Math.floor(ocrA / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1AL=0x${(ocrA % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1BH=0x${Math.floor(ocrB / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1BL=0x${(ocrB % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer 1 interrupts`,
    `TIMSK=(0<<OCIE2) | (0<<TOIE2) | (${ticie}<<TICIE1) | (${ocieA}<<OCIE1A) | (${ocieB}<<OCIE1B) | (${toie}<<TOIE1) | (0<<OCIE0) | (0<<TOIE0);`,
  ].join("\n");
}

// ─── TIMER 2 ─────────────────────────────────────────────────────────────────

const T2_PRESCALER: Record<string, string> = {
  off:    "(0<<CS22) | (0<<CS21) | (0<<CS20)",
  "1":    "(0<<CS22) | (0<<CS21) | (1<<CS20)",
  "8":    "(0<<CS22) | (1<<CS21) | (0<<CS20)",
  "32":   "(0<<CS22) | (1<<CS21) | (1<<CS20)",
  "64":   "(1<<CS22) | (0<<CS21) | (0<<CS20)",
  "128":  "(1<<CS22) | (0<<CS21) | (1<<CS20)",
  "256":  "(1<<CS22) | (1<<CS21) | (0<<CS20)",
  "1024": "(1<<CS22) | (1<<CS21) | (1<<CS20)",
};

const T2_MODE: Record<string, { pwm2: number; wgm21: number; wgm20: number; label: string }> = {
  normal:            { pwm2: 0, wgm21: 0, wgm20: 0, label: "Normal top=FFh" },
  phase_correct_pwm: { pwm2: 1, wgm21: 0, wgm20: 1, label: "Phase correct PWM top=FFh" },
  ctc:               { pwm2: 0, wgm21: 1, wgm20: 0, label: "CTC top=OCR2" },
  fast_pwm:          { pwm2: 1, wgm21: 1, wgm20: 1, label: "Fast PWM top=FFh" },
};

export function generateTimer2Init(config: Timer2Config): string {
  const mode = T2_MODE[config.mode];
  const prescaler = T2_PRESCALER[config.prescaler];
  const toie = config.overflowInterrupt ? 1 : 0;
  const ocie = config.compareInterrupt ? 1 : 0;
  const ocr = config.compareValue ?? 0;
  const async = config.asynchronous ? 1 : 0;

  return [
    `// --- Timer 2 ---`,
    `// Clock: ${config.prescaler === "off" ? "stopped" : `system clock / ${config.prescaler}`}`,
    `// Waveform mode: ${mode.label}`,
    `// OC2 pin: not connected`,
    `ASSR=(${async}<<AS2);`,
    `TCCR2=(${mode.pwm2}<<PWM2) | (0<<COM21) | (0<<COM20) | (${mode.wgm21}<<CTC2) | (0<<COM2) | ${prescaler};`,
    `TCNT2=0x00;`,
    `OCR2=0x${ocr.toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer 2 interrupts`,
    `TIMSK=(${ocie}<<OCIE2) | (${toie}<<TOIE2) | (0<<TICIE1) | (0<<OCIE1A) | (0<<OCIE1B) | (0<<TOIE1) | (0<<OCIE0) | (0<<TOIE0);`,
  ].join("\n");
}
