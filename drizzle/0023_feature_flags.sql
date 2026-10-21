CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
