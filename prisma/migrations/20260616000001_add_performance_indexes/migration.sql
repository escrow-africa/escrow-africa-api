-- Add updatedAt to Escrow
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- Escrow indexes for buyer/seller/status filter queries
CREATE INDEX IF NOT EXISTS "Escrow_buyerId_idx" ON "Escrow"("buyerId");
CREATE INDEX IF NOT EXISTS "Escrow_sellerId_idx" ON "Escrow"("sellerId");
CREATE INDEX IF NOT EXISTS "Escrow_status_idx" ON "Escrow"("status");
CREATE INDEX IF NOT EXISTS "Escrow_buyerId_status_idx" ON "Escrow"("buyerId", "status");
CREATE INDEX IF NOT EXISTS "Escrow_sellerId_status_idx" ON "Escrow"("sellerId", "status");

-- Payment index for per-user history queries
CREATE INDEX IF NOT EXISTS "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt" DESC);

-- Transaction index (replace single-column userId index)
DROP INDEX IF EXISTS "Transaction_userId_idx";
CREATE INDEX IF NOT EXISTS "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt" DESC);

-- Otp index for latest-by-email lookups
CREATE INDEX IF NOT EXISTS "Otp_email_createdAt_idx" ON "Otp"("email", "createdAt" DESC);

-- Dispute index for per-escrow lookups
CREATE INDEX IF NOT EXISTS "Dispute_escrowId_idx" ON "Dispute"("escrowId");
