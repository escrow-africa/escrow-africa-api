-- AlterEnum
ALTER TYPE "EscrowStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "approvalToken" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_approvalToken_key" ON "Escrow"("approvalToken");
