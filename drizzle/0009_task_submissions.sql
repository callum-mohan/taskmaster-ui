CREATE TYPE "public"."submission_kind" AS ENUM('photo', 'text');--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"team_id" text,
	"kind" "submission_kind" NOT NULL,
	"text" text,
	"object_key" text,
	"content_type" text,
	"size_bytes" integer,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_submissions_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "task_submissions_photo_has_object" CHECK (("task_submissions"."kind" = 'photo') = ("task_submissions"."object_key" is not null)),
	CONSTRAINT "task_submissions_text_has_body" CHECK ("task_submissions"."kind" <> 'text' or coalesce(length(trim("task_submissions"."text")), 0) > 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_submissions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "submission_kinds" "submission_kind"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_submissions_task_id_player_id_idx" ON "task_submissions" USING btree ("task_id","player_id");--> statement-breakpoint
CREATE INDEX "task_submissions_task_id_team_id_idx" ON "task_submissions" USING btree ("task_id","team_id");--> statement-breakpoint
CREATE INDEX "task_submissions_player_id_idx" ON "task_submissions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "task_submissions_team_id_idx" ON "task_submissions" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_max_submissions_range" CHECK ("tasks"."max_submissions" between 0 and 10);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_submission_kinds_when_open" CHECK ("tasks"."max_submissions" = 0 or cardinality("tasks"."submission_kinds") > 0);