ALTER TABLE "polls" ADD COLUMN "vote_bonus_points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "bonus_task_id" text;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_bonus_task_id_tasks_id_fk" FOREIGN KEY ("bonus_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_vote_bonus_points_range" CHECK ("polls"."vote_bonus_points" between 0 and 100);