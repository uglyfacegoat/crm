ALTER TABLE chat_messages
  ADD COLUMN body_is_placeholder boolean NOT NULL DEFAULT false;
