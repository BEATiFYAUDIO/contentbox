export class AsyncLifecycleMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export type UserQuickState = {
  mode: "off" | "quick" | "named" | null;
  autoStart: boolean;
};

export type QuickStartResult =
  | { ok: true; status: "ACTIVE"; publicOrigin: string | null }
  | { ok: false; code: string; message?: string };

export type QuickStartDependencies = {
  validate: () => Promise<{ ok: true } | { ok: false; code: string; message?: string }>;
  hasConsent: () => boolean;
  grantConsent: (dontAskAgain: boolean) => void;
  snapshot: () => UserQuickState;
  setMode: (mode: "off" | "quick" | "named" | null) => void;
  setAutoStart: (enabled: boolean) => void;
  startListener: () => Promise<void>;
  stopListener: () => Promise<void>;
  prepareTunnel: (signal?: AbortSignal) => Promise<{ ok: true } | { ok: false; error: string }>;
  startTunnel: () => Promise<{ status: string; publicOrigin?: string | null; lastError?: string | null }>;
  stopTunnel: () => Promise<unknown>;
};

export const DEFAULT_PREPARATION_TIMEOUT_MS = 120_000;

export async function prepareTunnelWithDeadline(
  prepareTunnel: QuickStartDependencies["prepareTunnel"],
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`cloudflared preparation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([prepareTunnel(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startAutomaticQuickRuntime(
  deps: Pick<QuickStartDependencies, "startListener" | "stopListener" | "prepareTunnel" | "startTunnel" | "stopTunnel">,
  preparationTimeoutMs = DEFAULT_PREPARATION_TIMEOUT_MS
) {
  try {
    await deps.startListener();
    const prepared = await prepareTunnelWithDeadline(deps.prepareTunnel, Math.max(1, preparationTimeoutMs));
    if (!prepared.ok) throw new Error(prepared.error);
    const status = await deps.startTunnel();
    if (status.status !== "ACTIVE") throw new Error(status.lastError || "Quick Tunnel failed to start");
    return status;
  } catch (error) {
    await deps.stopTunnel().catch(() => undefined);
    await deps.stopListener().catch(() => undefined);
    throw error;
  }
}

export async function startQuickTransaction(
  deps: QuickStartDependencies,
  input: {
    consent?: boolean;
    dontAskAgain?: boolean;
    enableAutoStart?: boolean;
    requireConsent?: boolean;
    persistSelection?: boolean;
    preparationTimeoutMs?: number;
  }
): Promise<QuickStartResult> {
  const validation = await deps.validate();
  if (!validation.ok) return validation;

  if (input.requireConsent !== false && !deps.hasConsent() && input.consent !== true) {
    return { ok: false, code: "consent_required" };
  }
  if (input.consent === true) deps.grantConsent(input.dontAskAgain === true);

  let prepared: Awaited<ReturnType<QuickStartDependencies["prepareTunnel"]>>;
  try {
    prepared = await prepareTunnelWithDeadline(
      deps.prepareTunnel,
      Math.max(1, input.preparationTimeoutMs ?? DEFAULT_PREPARATION_TIMEOUT_MS)
    );
  } catch (error: any) {
    return {
      ok: false,
      code: "cloudflared_download_failed",
      message: String(error?.message || error || "cloudflared preparation failed")
    };
  }
  if (!prepared.ok) {
    return { ok: false, code: "cloudflared_download_failed", message: prepared.error };
  }

  const before = deps.snapshot();
  const persistSelection = input.persistSelection !== false;
  if (persistSelection) {
    deps.setMode("quick");
    deps.setAutoStart(input.enableAutoStart !== false);
  }

  let stage: "listener" | "tunnel" = "listener";
  try {
    await deps.startListener();
    stage = "tunnel";
    const tunnel = await deps.startTunnel();
    if (tunnel.status !== "ACTIVE") {
      throw new Error(tunnel.lastError || "Quick Tunnel failed before a public URL was assigned");
    }
    return { ok: true, status: "ACTIVE", publicOrigin: tunnel.publicOrigin || null };
  } catch (error: any) {
    await deps.stopTunnel().catch(() => undefined);
    await deps.stopListener().catch(() => undefined);
    if (persistSelection) {
      deps.setMode(before.mode);
      deps.setAutoStart(before.autoStart);
    }
    return {
      ok: false,
      code: stage === "listener" ? "public_listener_start_failed" : "quick_tunnel_start_failed",
      message: String(error?.message || error || "Quick Tunnel failed to start")
    };
  }
}

export async function startNamedRuntimeAtStartup(input: {
  mutex: AsyncLifecycleMutex;
  startListener: () => Promise<void>;
  shouldStartTunnel: () => boolean;
  startTunnel: () => Promise<void>;
  onTunnelError?: (error: unknown) => void;
}) {
  let listenerReadyResolve!: () => void;
  let listenerReadyReject!: (error: unknown) => void;
  const listenerReady = new Promise<void>((resolve, reject) => {
    listenerReadyResolve = resolve;
    listenerReadyReject = reject;
  });
  const completion = input.mutex.runExclusive(async () => {
    try {
      await input.startListener();
      listenerReadyResolve();
    } catch (error) {
      listenerReadyReject(error);
      throw error;
    }
    if (input.shouldStartTunnel()) await input.startTunnel();
  });
  completion.catch((error) => input.onTunnelError?.(error));
  await listenerReady;
}
