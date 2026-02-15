import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const mode = String(process.env.DB_MODE || "").trim().toLowerCase();
const schema = mode === "advanced" ? "prisma/schema.prisma" : "prisma/schema.sqlite.prisma";

export default defineConfig({
  schema,
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
