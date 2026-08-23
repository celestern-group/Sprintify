import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth";

const email = process.argv[2] ?? env.SEED_ADMIN_EMAIL;
const password = process.argv[3] ?? env.SEED_ADMIN_PASSWORD;
const name = process.argv[4] ?? env.SEED_ADMIN_NAME ?? "Admin";

async function main() {
  if (!email || !password) {
    throw new Error(
      "Usage: pnpm admin:seed <email> <password> [name], or set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.",
    );
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!existing) {
    await auth.api.signUpEmail({ body: { email, password, name } });
    console.log(`Created user ${email}.`);
  } else {
    console.log(`User ${email} already exists.`);
  }

  await db
    .update(user)
    .set({ emailVerified: true, role: "superadmin" })
    .where(eq(user.email, email));

  console.log(`${email} is now a verified superadmin.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed admin:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
