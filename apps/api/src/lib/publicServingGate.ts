import type { PublicMode } from "./publicLinkState.js";

export type PublicStateSnapshot = {
  bootId: string;
  generation: number;
  configurationKey: string;
};

export class PublicStateEpoch {
  private generation = 0;
  private readonly bootId: string;
  private activeProbe: PublicStateSnapshot | null = null;

  constructor(bootId: string) {
    this.bootId = bootId;
  }

  invalidate() {
    this.generation += 1;
    this.activeProbe = null;
  }

  capture(configurationKey: string): PublicStateSnapshot {
    return { bootId: this.bootId, generation: this.generation, configurationKey };
  }

  beginProbe(configurationKey: string): PublicStateSnapshot {
    const snapshot = this.capture(configurationKey);
    this.activeProbe = snapshot;
    return snapshot;
  }

  finishProbe(snapshot: PublicStateSnapshot) {
    if (this.activeProbe === snapshot) this.activeProbe = null;
  }

  isCurrent(snapshot: PublicStateSnapshot, configurationKey: string): boolean {
    return (
      snapshot.bootId === this.bootId &&
      snapshot.generation === this.generation &&
      snapshot.configurationKey === configurationKey
    );
  }

  allowsPublicRequest(mode: PublicMode, path: string): boolean {
    if (mode !== "off") return true;
    const normalizedPath = String(path || "").split("?")[0] || "/";
    return normalizedPath === "/public/ping" && Boolean(this.activeProbe);
  }
}
