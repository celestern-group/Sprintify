CREATE TABLE "platformSettings" (
	"id" text PRIMARY KEY NOT NULL,
	"lockdownEnabled" boolean DEFAULT false NOT NULL,
	"lockdownMessage" text,
	"lockdownAt" timestamp,
	"lockdownByUserId" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
