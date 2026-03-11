import { ExternalInterruptConfig } from "../types";

const TRIGGER_ISC: Record<string, { bit1: number; bit0: number; label: string }> = {
  low_level:  { bit1: 0, bit0: 0, label: "Low level" },
  any_change: { bit1: 0, bit0: 1, label: "Any change" },
  falling:    { bit1: 1, bit0: 0, label: "Falling Edge" },
  rising:     { bit1: 1, bit0: 1, label: "Rising Edge"  },
};

export function generateExternalInterruptsInit(config: ExternalInterruptConfig): string {
  const int0 = config.int0;
  const int1 = config.int1;
  const int2 = config.int2;

  const isc0 = int0?.enabled ? TRIGGER_ISC[int0.trigger] : null;
  const isc1 = int1?.enabled ? TRIGGER_ISC[int1.trigger] : null;

  const isc01 = isc0?.bit1 ?? 0;
  const isc00 = isc0?.bit0 ?? 0;
  const isc11 = isc1?.bit1 ?? 0;
  const isc10 = isc1?.bit0 ?? 0;

  const int0en = int0?.enabled ? 1 : 0;
  const int1en = int1?.enabled ? 1 : 0;
  const int2en = int2?.enabled ? 1 : 0;
  const isc2 = int2?.trigger === "rising" ? 1 : 0;

  const isrs: string[] = [];
  if (int0?.enabled) {
    isrs.push(`// External Interrupt 0 service routine
interrupt [EXT_INT0] void ext_int0_isr(void)
{
// Place your code here
}`);
  }
  if (int1?.enabled) {
    isrs.push(`// External Interrupt 1 service routine
interrupt [EXT_INT1] void ext_int1_isr(void)
{
// Place your code here
}`);
  }
  if (int2?.enabled) {
    isrs.push(`// External Interrupt 2 service routine
interrupt [EXT_INT2] void ext_int2_isr(void)
{
// Place your code here
}`);
  }

  const init = [
    `// External Interrupt(s) initialization`,
    `// INT0: ${int0?.enabled ? `On (${TRIGGER_ISC[int0.trigger].label})` : "Off"}`,
    `// INT1: ${int1?.enabled ? `On (${TRIGGER_ISC[int1.trigger].label})` : "Off"}`,
    `// INT2: ${int2?.enabled ? `On (${int2.trigger === "rising" ? "Rising" : "Falling"} Edge)` : "Off"}`,
    `MCUCR=(${isc11}<<ISC11) | (${isc10}<<ISC10) | (${isc01}<<ISC01) | (${isc00}<<ISC00);`,
    `MCUCSR=(${isc2}<<ISC2);`,
    `GICR=(${int1en}<<INT1) | (${int0en}<<INT0) | (${int2en}<<INT2);`,
    `GIFR=(0<<INTF1) | (0<<INTF0) | (0<<INTF2);`,
  ].join("\n");

  return (isrs.length > 0 ? isrs.join("\n\n") + "\n\n" : "") + init;
}
