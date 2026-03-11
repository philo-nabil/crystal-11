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
    `// Timer/Counter 0 initialization`,
    `// Clock source: System Clock`,
    `// Clock value: ${config.prescaler === "off" ? "Timer0 Stopped" : `${config.prescaler} prescaler`}`,
    `// Mode: ${mode.label}`,
    `// OC0 output: Disconnected`,
    `TCCR0=(0<<WGM00) | (0<<COM01) | (0<<COM00) | (${mode.wgm01}<<WGM01) | ${prescaler};`,
    `TCNT0=0x00;`,
    `OCR0=0x${ocr.toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer/Counter 0 Interrupt(s) initialization`,
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

export function generateTimer1Init(config: Timer1Config): string {
  const prescaler = T1_PRESCALER[config.prescaler];
  const toie = config.overflowInterrupt ? 1 : 0;
  const ocieA = config.compareAInterrupt ? 1 : 0;
  const ocieB = config.compareBInterrupt ? 1 : 0;
  const ticie = config.captureInterrupt ? 1 : 0;
  const ocrA = config.compareA ?? 0;
  const ocrB = config.compareB ?? 0;
  const icr = config.inputCapture ?? 0;

  return [
    `// Timer/Counter 1 initialization`,
    `// Clock source: System Clock`,
    `// Clock value: ${config.prescaler === "off" ? "Timer1 Stopped" : `${config.prescaler} prescaler`}`,
    `// Mode: Normal top=FFFFh`,
    `// OC1A output: Disconnected`,
    `// OC1B output: Disconnected`,
    `// Noise Canceler: Off`,
    `// Input Capture on Falling Edge`,
    `// Timer1 Overflow Interrupt: ${config.overflowInterrupt ? "On" : "Off"}`,
    `// Input Capture Interrupt: ${config.captureInterrupt ? "On" : "Off"}`,
    `// Compare A Match Interrupt: ${config.compareAInterrupt ? "On" : "Off"}`,
    `// Compare B Match Interrupt: ${config.compareBInterrupt ? "On" : "Off"}`,
    `TCCR1A=(0<<COM1A1) | (0<<COM1A0) | (0<<COM1B1) | (0<<COM1B0) | (0<<FOC1A) | (0<<FOC1B) | (0<<WGM11) | (0<<WGM10);`,
    `TCCR1B=(0<<ICNC1) | (0<<ICES1) | (0<<WGM13) | (0<<WGM12) | ${prescaler};`,
    `TCNT1H=0x00;`,
    `TCNT1L=0x00;`,
    `ICR1H=0x${Math.floor(icr / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `ICR1L=0x${(icr % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1AH=0x${Math.floor(ocrA / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1AL=0x${(ocrA % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1BH=0x${Math.floor(ocrB / 256).toString(16).padStart(2, "0").toUpperCase()};`,
    `OCR1BL=0x${(ocrB % 256).toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer/Counter 1 Interrupt(s) initialization`,
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

const T2_MODE: Record<string, { wgm21: number; wgm20: number; label: string }> = {
  normal:            { wgm21: 0, wgm20: 0, label: "Normal top=FFh" },
  phase_correct_pwm: { wgm21: 0, wgm20: 1, label: "Phase correct PWM top=FFh" },
  ctc:               { wgm21: 1, wgm20: 0, label: "CTC top=OCR2" },
  fast_pwm:          { wgm21: 1, wgm20: 1, label: "Fast PWM top=FFh" },
};

export function generateTimer2Init(config: Timer2Config): string {
  const mode = T2_MODE[config.mode];
  const prescaler = T2_PRESCALER[config.prescaler];
  const toie = config.overflowInterrupt ? 1 : 0;
  const ocie = config.compareInterrupt ? 1 : 0;
  const ocr = config.compareValue ?? 0;
  const async = config.asynchronous ? 1 : 0;

  return [
    `// Timer/Counter 2 initialization`,
    `// Clock source: System Clock`,
    `// Clock value: ${config.prescaler === "off" ? "Timer2 Stopped" : `${config.prescaler} prescaler`}`,
    `// Mode: ${mode.label}`,
    `// OC2 output: Disconnected`,
    `ASSR=(${async}<<AS2);`,
    `TCCR2=(0<<PWM2) | (0<<COM21) | (0<<COM20) | (${mode.wgm21}<<CTC2) | (0<<COM2) | ${prescaler};`,
    `TCNT2=0x00;`,
    `OCR2=0x${ocr.toString(16).padStart(2, "0").toUpperCase()};`,
    ``,
    `// Timer/Counter 2 Interrupt(s) initialization`,
    `TIMSK=(${ocie}<<OCIE2) | (${toie}<<TOIE2) | (0<<TICIE1) | (0<<OCIE1A) | (0<<OCIE1B) | (0<<TOIE1) | (0<<OCIE0) | (0<<TOIE0);`,
  ].join("\n");
}
