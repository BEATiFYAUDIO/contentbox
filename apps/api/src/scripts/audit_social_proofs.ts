import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { auditSocialProofs, writeSocialProofAuditReports } from "../modules/witness/socialProofAudit.js";

const prisma = new PrismaClient();

try {
  const report = await auditSocialProofs(prisma);
  const outDir = path.resolve(process.cwd(), "tmp", "proof-audits");
  const paths = await writeSocialProofAuditReports(report, outDir);
  console.log(JSON.stringify({ counts: report.counts, paths }, null, 2));
} finally {
  await prisma.$disconnect();
}
