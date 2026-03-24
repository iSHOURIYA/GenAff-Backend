-- CreateTable
CREATE TABLE "pending_password_resets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_password_resets_token_key" ON "pending_password_resets"("token");

-- CreateIndex
CREATE INDEX "pending_password_resets_user_id_idx" ON "pending_password_resets"("user_id");

-- AddForeignKey
ALTER TABLE "pending_password_resets"
ADD CONSTRAINT "pending_password_resets_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
