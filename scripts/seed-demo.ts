/** Idempotent synthetic seeding (§32.2). Run: pnpm seed */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { getClinicianClient } from "../lib/medplum/client";
import { seedCanonicalCase } from "../lib/medplum/seed";

async function main(): Promise<void> {
  const medplum = await getClinicianClient();
  const ids = await seedCanonicalCase(medplum);
  console.log("Seeded canonical Rosa case (find-or-create, stable across runs):");
  for (const [name, id] of Object.entries(ids)) {
    console.log(`  ${name}: ${id}`);
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
