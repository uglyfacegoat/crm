CREATE TABLE file_write_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  accepting boolean NOT NULL DEFAULT true,
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO file_write_control (id, accepting) VALUES (true, true);

CREATE TABLE file_write_operations (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  storage_keys text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX file_write_operations_started_idx ON file_write_operations (started_at);
