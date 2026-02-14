import Fastify from "fastify";

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 4010);

type RegisterFn = (app: any) => void;

export async function startPublicServer(registerPublicRoutes: RegisterFn, host: string) {
  const app = Fastify({
    logger: { level: "warn" },
    bodyLimit: 2 * 1024 * 1024
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
