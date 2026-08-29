import { spawn } from "node:child_process";

/** Hold a macOS power assertion so idle sleep does not freeze the host. Full shutdown still stops it. */
export function keepHostAwake() {
  if (process.platform !== "darwin") return;
  try {
    const child = spawn("caffeinate", ["-ims", "-w", String(process.pid)], {
      stdio: "ignore",
    });
    child.on("error", () => {
      /* caffeinate missing — server still runs, Mac may idle-sleep */
    });
    console.log("Holding macOS idle-sleep assertion (stops only on shutdown or process exit)");
  } catch {
    /* ignore */
  }
}
