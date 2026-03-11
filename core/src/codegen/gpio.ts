import { PortConfig, PinConfig } from "./types";

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

  const dirBits = padded.map((p, i) => `(${pinDirection(p)}<<DD${portLetter}${i})`).reverse().join(" | ");
  const stateBits = padded.map((p, i) => `(${pinState(p)}<<PORT${portLetter}${i})`).reverse().join(" | ");

  const dirComment = padded.map((p, i) => `Bit${7 - i}=${p.mode === "out" ? "Out" : "In"}`).join(" ");
  const stateComment = padded.map((p, i) => {
    if (p.mode === "out") return `Bit${7 - i}=${p.state === "high" ? "1" : "0"}`;
    return `Bit${7 - i}=${p.state === "pullup" ? "P" : "T"}`;
  }).join(" ");

  return [
    `// Port ${portLetter} initialization`,
    `// Function: ${dirComment} `,
    `DDR${portLetter}=${dirBits};`,
    `// State: ${stateComment} `,
    `PORT${portLetter}=${stateBits};`,
  ].join("\n");
}

export function generateGPIO(config: PortConfig): string {
  const lines: string[] = ["// Input/Output Ports initialization"];

  for (const port of PORTS) {
    const pins = config[port] ?? Array(8).fill(defaultPin());
    lines.push(generatePortInit(port, pins));
  }

  return lines.join("\n");
}
