import Fastify from "fastify";

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 4010);

type RegisterFn = (app: any) => void;

export async function startPublicServer(registerPublicRoutes: RegisterFn, host: string) {
  const app = Fastify({
    logger: { level: "warn" },
    bodyLimit: 2 * 1024 * 1024
  });

  // Match API server behavior: allow empty JSON request bodies.
  const jsonParser = (_req: any, body: string, done: (err: Error | null, value?: any) => void) => {
    const raw = String(body || "").trim();
    if (!raw) return done(null, {});
    try {
      return done(null, JSON.parse(raw));
    } catch (e: any) {
      return done(e);
    }
  };
  app.addContentTypeParser("application/json", { parseAs: "string" }, jsonParser);
  app.addContentTypeParser("application/*+json", { parseAs: "string" }, jsonParser);

  // Minimal CORS for public routes (invite/buy links accessed from other origins)
  app.addHook("onSend", async (_req: any, reply: any, payload: any) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "Content-Type, Authorization");
    return payload;
  });

  app.options("/*", async (_req: any, reply: any) => {
    return reply.code(204).send();
  });

  app.addHook("onRequest", async (req: any) => {
    if (req.headers && "authorization" in req.headers) {
      delete (req.headers as any).authorization;
    }
  });

  registerPublicRoutes(app);
  await app.listen({ port: PUBLIC_PORT, host });
  return app;
}
