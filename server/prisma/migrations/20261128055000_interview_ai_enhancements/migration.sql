-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "aiDecisionSummary" JSONB;

-- AlterTable
ALTER TABLE "MatchSuggestion" ADD COLUMN IF NOT EXISTS "aiInterviewQuestions" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transcript_meetingId_createdAt_idx" ON "Transcript"("meetingId", "createdAt");
