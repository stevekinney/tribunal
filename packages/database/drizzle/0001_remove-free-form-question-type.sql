ALTER TABLE "question" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "question" SET "type" = 'long_form' WHERE "type" = 'free_form';--> statement-breakpoint
DROP TYPE "public"."question_type";--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('short_answer', 'multiple_choice', 'long_form', 'true_false', 'slider', 'stack_ranking', 'numeric');--> statement-breakpoint
ALTER TABLE "question" ALTER COLUMN "type" SET DATA TYPE "public"."question_type" USING "type"::"public"."question_type";