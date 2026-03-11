import { ADCConfig } from "../types";

const VREF_BITS: Record<string, string> = {
  aref:     "(0<<REFS1) | (0<<REFS0)",
  avcc:     "(0<<REFS1) | (1<<REFS0)",
  internal: "(1<<REFS1) | (1<<REFS0)",
};

const TRIGGER_BITS: Record<string, string> = {
  stopped:           "(0<<ADTS2) | (0<<ADTS1) | (0<<ADTS0)",
  free_running:      "(0<<ADTS2) | (0<<ADTS1) | (0<<ADTS0)",
  analog_comparator: "(0<<ADTS2) | (0<<ADTS1) | (1<<ADTS0)",
  ext_irq0:          "(0<<ADTS2) | (1<<ADTS1) | (0<<ADTS0)",
  timer0_compare:    "(0<<ADTS2) | (1<<ADTS1) | (1<<ADTS0)",
  timer0_overflow:   "(1<<ADTS2) | (0<<ADTS1) | (0<<ADTS0)",
  timer1_compare_b:  "(1<<ADTS2) | (0<<ADTS1) | (1<<ADTS0)",
  timer1_overflow:   "(1<<ADTS2) | (1<<ADTS1) | (0<<ADTS0)",
  timer1_capture:    "(1<<ADTS2) | (1<<ADTS1) | (1<<ADTS0)",
};

// prescaler to get closest ADC clock (should be 50-200kHz ideally)
function calcPrescaler(clockHz: number, targetKHz: number): { bits: string; actual: number } {
  const prescalers = [
    { div: 2,   bits: "(0<<ADPS2) | (0<<ADPS1) | (1<<ADPS0)" },
    { div: 4,   bits: "(0<<ADPS2) | (1<<ADPS1) | (0<<ADPS0)" },
    { div: 8,   bits: "(0<<ADPS2) | (1<<ADPS1) | (1<<ADPS0)" },
    { div: 16,  bits: "(1<<ADPS2) | (0<<ADPS1) | (0<<ADPS0)" },
    { div: 32,  bits: "(1<<ADPS2) | (0<<ADPS1) | (1<<ADPS0)" },
    { div: 64,  bits: "(1<<ADPS2) | (1<<ADPS1) | (0<<ADPS0)" },
    { div: 128, bits: "(1<<ADPS2) | (1<<ADPS1) | (1<<ADPS0)" },
  ];
  const target = targetKHz * 1000;
  let best = prescalers[prescalers.length - 1];
  let bestDiff = Infinity;
  for (const p of prescalers) {
    const actual = clockHz / p.div;
    const diff = Math.abs(actual - target);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return { bits: best.bits, actual: (clockHz / best.div) / 1000 };
}

export function generateADCPreamble(config: ADCConfig): string {
  if (!config.enabled) return "";

  const adlar = config.use8bit ? 1 : 0;
  const vrefBits = VREF_BITS[config.voltRef];
  const adlarBit = `(${adlar}<<ADLAR)`;
  const vrefLine = `#define ADC_VREF_TYPE (${vrefBits} | ${adlarBit})`;

  if (!config.interrupt) {
    if (config.use8bit) {
      return `${vrefLine}
// Read the 8 most significant bits
// of the AD conversion result
unsigned char read_adc(unsigned char adc_input)
{
ADMUX=adc_input | ADC_VREF_TYPE;
// Delay needed for the stabilization of the ADC input voltage
delay_us(10);
// Start the AD conversion
ADCSRA|=(1<<ADSC);
// Wait for the AD conversion to complete
while ((ADCSRA & (1<<ADIF))==0);
ADCSRA|=(1<<ADIF);
return ADCH;
}`;
    } else {
      return `${vrefLine}
// Read the AD conversion result
unsigned int read_adc(unsigned char adc_input)
{
ADMUX=adc_input | ADC_VREF_TYPE;
// Delay needed for the stabilization of the ADC input voltage
delay_us(10);
// Start the AD conversion
ADCSRA|=(1<<ADSC);
// Wait for the AD conversion to complete
while ((ADCSRA & (1<<ADIF))==0);
ADCSRA|=(1<<ADIF);
return ADCW;
}`;
    }
  }

  // with interrupt
  if (config.noiseCanceler) {
    return `unsigned char adc_data;
${vrefLine}
// ADC interrupt service routine
interrupt [ADC_INT] void adc_isr(void)
{
// Read the 8 most significant bits
// of the AD conversion result
adc_data=ADCH;
}
// Read the 8 most significant bits
// of the AD conversion result
// with noise canceling
unsigned char read_adc(unsigned char adc_input)
{
ADMUX=adc_input | ADC_VREF_TYPE;
// Delay needed for the stabilization of the ADC input voltage
delay_us(10);
#asm
    in   r30,mcucr
    cbr  r30,__sm_mask
    sbr  r30,__se_bit | __sm_adc_noise_red
    out  mcucr,r30
    sleep
    cbr  r30,__se_bit
    out  mcucr,r30
#endasm
return adc_data;
}`;
  }

  return `${vrefLine}
// ADC interrupt service routine
interrupt [ADC_INT] void adc_isr(void)
{
unsigned char adc_data;
// Read the 8 most significant bits
// of the AD conversion result
adc_data=ADCH;
// Place your code here
}`;
}

export function generateADCInit(config: ADCConfig, clockHz: number): string {
  if (!config.enabled) return "";

  const { bits: prescalerBits, actual } = calcPrescaler(clockHz, config.clockKHz);
  const adate = config.triggerSource !== "stopped" ? 1 : 0;
  const adie = config.interrupt ? 1 : 0;
  const trigBits = TRIGGER_BITS[config.triggerSource];

  const vrefStr = config.voltRef === "aref" ? "AREF pin" : config.voltRef === "avcc" ? "AVCC pin" : "Internal 2.56V";
  const trigStr = config.triggerSource.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const lines = [
    `// ADC initialization`,
    `// ADC Clock frequency: ${actual.toFixed(3)} kHz`,
    `// ADC Voltage Reference: ${vrefStr}`,
    `// ADC Auto Trigger Source: ${config.triggerSource === "stopped" ? "ADC Stopped" : trigStr}`,
  ];

  if (config.use8bit) {
    lines.push(`// Only the 8 most significant bits of`);
    lines.push(`// the AD conversion result are used`);
  }

  lines.push(`ADMUX=ADC_VREF_TYPE;`);
  lines.push(`ADCSRA=(1<<ADEN) | (0<<ADSC) | (${adate}<<ADATE) | (0<<ADIF) | (${adie}<<ADIE) | ${prescalerBits};`);
  lines.push(`SFIOR=${trigBits};`);

  return lines.join("\n");
}
