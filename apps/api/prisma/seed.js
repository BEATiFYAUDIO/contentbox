import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });



async function main() {
  const methods = [
    { code: "manual", displayName: "Manual payout", isEnabled: true, isVisible: true, sortOrder: 10 },
    { code: "lightning_address", displayName: "Lightning Address", isEnabled: true, isVisible: true, sortOrder: 20 },
    { code: "lnurl", displayName: "LNURL-Pay", isEnabled: true, isVisible: true, sortOrder: 30 },
    { code: "btc_onchain", displayName: "BTC On-chain (XPUB)", isEnabled: true, isVisible: true, sortOrder: 40 },

    { code: "stripe_connect", displayName: "Stripe Connect (Coming soon)", isEnabled: false, isVisible: true, sortOrder: 90 },
    { code: "paypal", displayName: "PayPal (Coming soon)", isEnabled: false, isVisible: true, sortOrder: 100 }
  ];

  for (const m of methods) {
    await prisma.payoutMethod.upsert({
      where: { code: m.code },
      update: {
        displayName: m.displayName,
        isEnabled: m.isEnabled,
        isVisible: m.isVisible,
        sortOrder: m.sortOrder
      },
      create: m
    });
  }

  console.log("Seeded payout methods.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
