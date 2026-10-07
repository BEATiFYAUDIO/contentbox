import { startQuickTransaction, type AsyncLifecycleMutex, type QuickStartDependencies } from "./publicLifecycle.js";

type ReplyLike = {
  code: (statusCode: number) => ReplyLike;
  send: (payload: unknown) => unknown;
};

export type PublicGoRouteDependencies = {
  mutex: AsyncLifecycleMutex;
  requireAuth: unknown;
  getMode: () => "off" | "quick" | "named";
  handleNamed: (reply: ReplyLike) => Promise<unknown>;
  environmentForcesQuick: () => boolean;
  quick: () => QuickStartDependencies;
  getStatus: () => Record<string, unknown>;
};

export function registerPublicGoRoute(app: any, deps: PublicGoRouteDependencies) {
  app.post("/api/public/go", { preHandler: deps.requireAuth }, async (request: any, reply: ReplyLike) => {
    return deps.mutex.runExclusive(async () => {
      if (deps.getMode() === "named") return deps.handleNamed(reply);

      const body = (request.body ?? {}) as { consent?: boolean; dontAskAgain?: boolean };
      const environmentForced = deps.environmentForcesQuick();
      const result = await startQuickTransaction(deps.quick(), {
        consent: body.consent,
        dontAskAgain: body.dontAskAgain,
        enableAutoStart: true,
        requireConsent: !environmentForced,
        persistSelection: !environmentForced
      });
      if (!result.ok) {
        const statusCode = result.code === "consent_required" || result.code === "named_configured" ? 409 : 503;
        return reply.code(statusCode).send({
          ...deps.getStatus(),
          lastError: result.code,
          message: result.message,
          consentRequired: result.code === "consent_required"
        });
      }
      return reply.send(deps.getStatus());
    });
  });
}

export type PublicStopRouteDependencies = {
  mutex: AsyncLifecycleMutex;
  requireAuth: unknown;
  getMode: () => "off" | "quick" | "named";
  getSelection: () => { mode: "off" | "quick" | "named"; source: "environment" | "user" | "legacy" | "default" };
  stopTunnel: () => Promise<unknown>;
  stopListener: () => Promise<void>;
  persistMode: (mode: "off") => void;
  setAutoStart: (enabled: boolean) => void;
  getStatus: () => Record<string, unknown>;
};

export function registerPublicStopRoute(app: any, deps: PublicStopRouteDependencies) {
  app.post("/api/public/stop", { preHandler: deps.requireAuth }, async (_request: any, reply: ReplyLike) => {
    return deps.mutex.runExclusive(async () => {
      const modeBeforeStop = deps.getMode();
      const selection = deps.getSelection();
      await deps.stopTunnel();
      if (selection.mode === "quick" && (selection.source === "user" || selection.source === "legacy")) {
        deps.persistMode("off");
        deps.setAutoStart(false);
      }
      if (modeBeforeStop !== "named") await deps.stopListener();
      return reply.send({
        ...deps.getStatus(),
        state: "STOPPED",
        publicOrigin: null,
        lastError: null
      });
    });
  });
}
