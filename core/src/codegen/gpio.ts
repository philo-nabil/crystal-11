import { PortConfig, PinConfig } from "../types";

const PORTS = ["A", "B", "C", "D"] as const;

function defaultPin(): PinConfig {
  return { mode: "in", state: "tristate" };
}

function pinDirection(pin: PinConfig): 0 | 1 {
  return pin.mode === "out" ? 1 : 0;
}

function pinState(pin: PinConfig): 0 | 1 {
  if (pin.mode === "out") return pin.state === "high" ? 1 : 0;
  return pin.state === "pullup" ? 1 : 0;
}

function generatePortInit(portLetter: string, pins: PinConfig[]): string {
  const padded = [...pins];
  while (padded.length < 8) padded.push(defaultPin());

  const dirBits = padded.map((p, i) => `(${pinDirection(p)}<<DDR${portLetter}${i})`).reverse().join(" | ");
  const stateBits = padded.map((p, i) => `(${pinState(p)}<<PORT${portLetter}${i})`).reverse().join(" | ");

  // Comments list Bit7..Bit0 (descending), matching the register-term order
  // above. Iterate a reversed copy so the label always matches the pin it
  // describes — mapping "7 - i" straight over the unreversed array (as this
  // function did before) silently swaps every pin's label with its mirror bit.
  const reversedForComment = [...padded].reverse();
  const dirComment = reversedForComment
    .map((p, revIdx) => `Bit${7 - revIdx}=${p.mode === "out" ? "Out" : "In"}`)
    .join(" ");
  const stateComment = reversedForComment
    .map((p, revIdx) => {
      const bit = 7 - revIdx;
      if (p.mode === "out") return `Bit${bit}=${p.state === "high" ? "1" : "0"}`;
      return `Bit${bit}=${p.state === "pullup" ? "P" : "T"}`;
    })
    .join(" ");

  return [
    `// --- Port ${portLetter} ---`,
    `// Direction (1 = output, 0 = input), bit7..bit0: ${dirComment}`,
    `DDR${portLetter}=${dirBits};`,
    `// Output level, or input pull-up/tristate, bit7..bit0: ${stateComment}`,
    `PORT${portLetter}=${stateBits};`,
  ].join("\n");
}

export function generateGPIO(config: PortConfig): string {
  const lines: string[] = ["// --- GPIO setup ---"];

  for (const port of PORTS) {
    const pins = config[port] ?? Array(8).fill(defaultPin());
    lines.push(generatePortInit(port, pins));
  }

  return lines.join("\n");
}