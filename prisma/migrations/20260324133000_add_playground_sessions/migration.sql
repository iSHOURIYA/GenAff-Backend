-- AlterTable
ALTER TABLE "api_keys"
ADD COLUMN "is_playground" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expires_at" TIMESTAMP(3),
ADD COLUMN "playground_session_id" TEXT;

-- CreateTable
CREATE TABLE "playground_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Chat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playground_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playground_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "cost_inr" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playground_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_playground_session_id_key" ON "api_keys"("playground_session_id");

-- CreateIndex
CREATE INDEX "api_keys_is_playground_expires_at_idx" ON "api_keys"("is_playground", "expires_at");

-- CreateIndex
CREATE INDEX "playground_sessions_user_id_expires_at_idx" ON "playground_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "playground_messages_session_id_created_at_idx" ON "playground_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "playground_sessions"
ADD CONSTRAINT "playground_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playground_messages"
ADD CONSTRAINT "playground_messages_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "playground_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playground_messages"
ADD CONSTRAINT "playground_messages_api_key_id_fkey"
FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys"
ADD CONSTRAINT "api_keys_playground_session_id_fkey"
FOREIGN KEY ("playground_session_id") REFERENCES "playground_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
