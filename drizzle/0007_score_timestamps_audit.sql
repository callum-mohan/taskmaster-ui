CREATE TYPE "public"."score_audit_action" AS ENUM('created', 'updated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."score_audit_entity" AS ENUM('task_score', 'team_score', 'bonus');--> statement-breakpoint
CREATE TABLE "score_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "score_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"task_id" text NOT NULL,
	"entity" "score_audit_entity" NOT NULL,
	"action" "score_audit_action" NOT NULL,
	"subject_id" text NOT NULL,
	"bonus_id" integer,
	"points_before" integer,
	"points_after" integer,
	"note_before" text,
	"note_after" text
);
--> statement-breakpoint
ALTER TABLE "bonus_points" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bonus_points" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_scores" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_scores" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "team_scores" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "team_scores" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "score_audit_log_task_id_at_idx" ON "score_audit_log" USING btree ("task_id","at");