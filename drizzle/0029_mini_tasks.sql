CREATE TABLE "mini_task_completions" (
	"mini_task_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"season_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mini_task_completions_mini_task_id_player_id_pk" PRIMARY KEY("mini_task_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "mini_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mini_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reward" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mini_tasks_id_season_id_unique" UNIQUE("id","season_id"),
	CONSTRAINT "mini_tasks_reward_range" CHECK ("mini_tasks"."reward" between 1 and 5),
	CONSTRAINT "mini_tasks_ends_after_start" CHECK ("mini_tasks"."ends_on" >= "mini_tasks"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "mini_task_completions" ADD CONSTRAINT "mini_task_completions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mini_task_completions" ADD CONSTRAINT "mini_task_completions_task_season_fk" FOREIGN KEY ("mini_task_id","season_id") REFERENCES "public"."mini_tasks"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mini_task_completions" ADD CONSTRAINT "mini_task_completions_player_season_fk" FOREIGN KEY ("player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mini_tasks" ADD CONSTRAINT "mini_tasks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mini_task_completions_player_id_idx" ON "mini_task_completions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "mini_tasks_season_id_starts_on_idx" ON "mini_tasks" USING btree ("season_id","starts_on");