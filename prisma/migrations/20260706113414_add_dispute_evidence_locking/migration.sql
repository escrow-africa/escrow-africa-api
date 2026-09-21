/*
  Warnings:

  - You are about to drop the column `escrowId` on the `Dispute` table. All the data in the column will be lost.
  - You are about to drop the column `raisedBy` on the `Dispute` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `Dispute` table. All the data in the column will be lost.
  - You are about to drop the column `resolvedAt` on the `Dispute` table. All the data in the column will be lost.
  - The `resolvedBy` column on the `Dispute` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `breachCategory` to the `Dispute` table without a default value. This is not possible if the table is not empty.
  - Added the required column `claimDescription` to the `Dispute` table without a default value. This is not possible if the table is not empty.
  - Added the required column `disputedAmount` to the `Dispute` table without a default value. This is not possible if the table is not empty.
  - Added the required column `openedById` to the `Dispute` table without a default value. This is not possible if the table is not empty.
  - Added the required column `relatedContractId` to the `Dispute` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BreachCategory" AS ENUM ('QUALITY_ISSUES', 'DELAYED_DELIVERY', 'COMMUNICATION_CESSATION', 'OUT_OF_SCOPE_DEMANDS', 'OTHERS');

-- CreateEnum
CREATE TYPE "DisputeEventType" AS ENUM ('STATUS_CHANGE', 'EVIDENCE_ADDED', 'EVIDENCE_REMOVED', 'RESOLUTION_PROPOSED', 'RESOLUTION_ACCEPTED', 'BOT_ANALYSIS_RESULT');

-- CreateEnum
CREATE TYPE "ResolvedBy" AS ENUM ('ADMIN_DECISION', 'BOT_ADJUDICATION', 'MUTUAL_SETTLEMENT', 'SYSTEM_AUTO_RELEASE');

-- DropIndex
DROP INDEX "Dispute_escrowId_idx";

-- AlterTable
ALTER TABLE "Dispute" DROP COLUMN "escrowId",
DROP COLUMN "raisedBy",
DROP COLUMN "reason",
DROP COLUMN "resolvedAt",
ADD COLUMN     "breachCategory" "BreachCategory" NOT NULL,
ADD COLUMN     "claimDescription" TEXT NOT NULL,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "disputedAmount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "openedById" TEXT NOT NULL,
ADD COLUMN     "relatedContractId" TEXT NOT NULL,
DROP COLUMN "resolvedBy",
ADD COLUMN     "resolvedBy" "ResolvedBy";

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedReason" TEXT;

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "proofOfBreach" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvent" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "eventType" "DisputeEventType" NOT NULL,
    "payload" JSONB,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evidence_disputeId_idx" ON "Evidence"("disputeId");

-- CreateIndex
CREATE INDEX "Evidence_fileHash_idx" ON "Evidence"("fileHash");

-- CreateIndex
CREATE INDEX "Evidence_createdAt_idx" ON "Evidence"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "DisputeEvent_disputeId_idx" ON "DisputeEvent"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeEvent_createdAt_idx" ON "DisputeEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Dispute_relatedContractId_idx" ON "Dispute"("relatedContractId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_createdAt_idx" ON "Dispute"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Escrow_isLocked_idx" ON "Escrow"("isLocked");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_relatedContractId_fkey" FOREIGN KEY ("relatedContractId") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvent" ADD CONSTRAINT "DisputeEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
