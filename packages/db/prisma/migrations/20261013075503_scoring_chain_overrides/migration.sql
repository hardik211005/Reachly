-- AlterTable
ALTER TABLE "scoring_profiles" ADD COLUMN     "chainOverrides" JSONB NOT NULL DEFAULT '{}';
