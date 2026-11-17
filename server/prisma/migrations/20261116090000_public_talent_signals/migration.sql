-- Vitrine « Talents recommandés » ouverte aux signaux (décision 2026-11-16).
-- Migration purement additive : aucune donnée existante modifiée.
-- 1. Masquage admin de la vitrine, sur le profil et sur le signal.
-- 2. Identifiant public aléatoire d'un signal (jamais l'id), généré à la
--    création du signal ou paresseusement à la première lecture de la vitrine.
-- 3. Une demande de contact peut viser un signal non converti : `talentId`
--    devient facultatif, `signalId` est ajouté (rempli à la conversion par
--    le `talentId` du profil créé ; suit la cible d'une fusion).

-- AlterTable
ALTER TABLE "TalentProfile" ADD COLUMN     "publicHiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TalentContactRequest" ADD COLUMN     "signalId" TEXT,
ALTER COLUMN "talentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TalentSignal" ADD COLUMN     "publicHiddenAt" TIMESTAMP(3),
ADD COLUMN     "publicRef" TEXT;

-- CreateIndex
CREATE INDEX "TalentContactRequest_signalId_idx" ON "TalentContactRequest"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentSignal_publicRef_key" ON "TalentSignal"("publicRef");

-- AddForeignKey
ALTER TABLE "TalentContactRequest" ADD CONSTRAINT "TalentContactRequest_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "TalentSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
