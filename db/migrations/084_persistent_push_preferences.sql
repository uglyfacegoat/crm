ALTER TABLE chat_push_subscriptions
  ALTER COLUMN session_id DROP NOT NULL,
  DROP CONSTRAINT chat_push_subscriptions_session_id_fkey,
  ADD CONSTRAINT chat_push_subscriptions_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE SET NULL;
