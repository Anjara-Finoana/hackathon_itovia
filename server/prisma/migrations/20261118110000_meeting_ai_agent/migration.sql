-- CreateEnum
CREATE TYPE "MeetingPlatform" AS ENUM ('google_meet', 'zoom', 'teams', 'autre');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('planifie', 'en_cours', 'termine', 'annule', 'echec');

-- CreateEnum
CREATE TYPE "BotProvider" AS ENUM ('recall_ai', 'meeting_baas', 'custom_headless');

-- CreateEnum
CREATE TYPE "MeetingBotStatus" AS ENUM ('initialise', 'connexion', 'salle_attente', 'en_appel', 'enregistrement', 'deconnexion', 'termine', 'erreur');

-- CreateEnum
CREATE TYPE "SpeakerRole" AS ENUM ('recruteur', 'candidat', 'observateur', 'inconnu');

-- CreateEnum
CREATE TYPE "ActionItemPriority" AS ENUM ('urgente', 'haute', 'normale', 'basse');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('a_faire', 'en_cours', 'termine', 'annule');

-- CreateEnum
CREATE TYPE "NoteRecommendation" AS ENUM ('retenu', 'second_entretien', 'non_retenu', 'absent');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetUrl" TEXT NOT NULL,
    "platform" "MeetingPlatform" NOT NULL DEFAULT 'google_meet',
    "status" "MeetingStatus" NOT NULL DEFAULT 'planifie',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "recordingUrl" TEXT,
    "recruiterConsent" BOOLEAN NOT NULL DEFAULT false,
    "candidateConsent" BOOLEAN NOT NULL DEFAULT false,
    "recruiterConsentAt" TIMESTAMP(3),
    "candidateConsentAt" TIMESTAMP(3),
    "interviewId" TEXT,
    "hostId" TEXT NOT NULL,
    "participantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingBot" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "provider" "BotProvider" NOT NULL DEFAULT 'custom_headless',
    "externalBotId" TEXT,
    "botName" TEXT NOT NULL DEFAULT 'Finoana Scribe',
    "status" "MeetingBotStatus" NOT NULL DEFAULT 'initialise',
    "failureReason" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "speakerName" TEXT NOT NULL,
    "speakerRole" "SpeakerRole" NOT NULL DEFAULT 'inconnu',
    "speakerId" TEXT,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "isFinal" BOOLEAN NOT NULL DEFAULT true,
    "chunkIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyTakeaways" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidateStrengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidateWeaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technicalAssessment" TEXT,
    "softSkillsAssessment" TEXT,
    "culturalFitScore" INTEGER,
    "technicalFitScore" INTEGER,
    "recommendation" "NoteRecommendation",
    "recommendedReason" "InterviewResultReason",
    "rawAiResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeRole" "SpeakerRole" NOT NULL DEFAULT 'recruteur',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "ActionItemPriority" NOT NULL DEFAULT 'normale',
    "status" "ActionItemStatus" NOT NULL DEFAULT 'a_faire',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_interviewId_key" ON "Meeting"("interviewId");

-- CreateIndex
CREATE INDEX "Meeting_hostId_idx" ON "Meeting"("hostId");

-- CreateIndex
CREATE INDEX "Meeting_participantId_idx" ON "Meeting"("participantId");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE INDEX "Meeting_scheduledAt_idx" ON "Meeting"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingBot_externalBotId_key" ON "MeetingBot"("externalBotId");

-- CreateIndex
CREATE INDEX "MeetingBot_meetingId_idx" ON "MeetingBot"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingBot_status_idx" ON "MeetingBot"("status");

-- CreateIndex
CREATE INDEX "Transcript_meetingId_startTime_idx" ON "Transcript"("meetingId", "startTime");

-- CreateIndex
CREATE INDEX "Transcript_meetingId_chunkIndex_idx" ON "Transcript"("meetingId", "chunkIndex");

-- CreateIndex
CREATE INDEX "Note_meetingId_idx" ON "Note"("meetingId");

-- CreateIndex
CREATE INDEX "ActionItem_meetingId_status_idx" ON "ActionItem"("meetingId", "status");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingBot" ADD CONSTRAINT "MeetingBot_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
