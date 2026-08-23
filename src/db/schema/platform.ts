import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Platform-wide runtime switches. Single row (id is always "platform") so
// admins can toggle behaviour at runtime without a deploy. Read on every gated
// creation path; keep it tiny.
//
// - lockdown*: the emergency "red button" — freezes ALL new user/org/project/
//   team/invite creation platform-wide during an incident.
// - signupDisabled: "invite only" mode — turns off self-serve public sign-up
//   while org invitations keep working (invitees are provisioned server-side).
// - wishlistEnabled: allows people to request platform access while invite-only
//   mode is active. It defaults off so existing invite-only deployments remain
//   closed unless an administrator deliberately opens this route.
export const platformSettings = pgTable("platformSettings", {
  id: text().primaryKey(),
  lockdownEnabled: boolean().default(false).notNull(),
  lockdownMessage: text(),
  lockdownAt: timestamp(),
  lockdownByUserId: text(),
  signupDisabled: boolean().default(false).notNull(),
  wishlistEnabled: boolean().default(false).notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
