-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_suspended" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_model_restrictions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_model_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_model_restrictions_user_id_idx" ON "user_model_restrictions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_model_restrictions_user_id_model_key" ON "user_model_restrictions"("user_id", "model");

-- AddForeignKey
ALTER TABLE "user_model_restrictions" ADD CONSTRAINT "user_model_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
