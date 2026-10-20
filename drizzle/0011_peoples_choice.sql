CREATE TABLE "peoples_choice_votes" (
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"submission_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peoples_choice_votes_task_id_player_id_pk" PRIMARY KEY("task_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "peoples_choice_votes" ADD CONSTRAINT "peoples_choice_votes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peoples_choice_votes" ADD CONSTRAINT "peoples_choice_votes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peoples_choice_votes" ADD CONSTRAINT "peoples_choice_votes_submission_fk" FOREIGN KEY ("submission_id","task_id") REFERENCES "public"."task_submissions"("id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peoples_choice_votes_submission_id_idx" ON "peoples_choice_votes" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "peoples_choice_votes_player_id_idx" ON "peoples_choice_votes" USING btree ("player_id");