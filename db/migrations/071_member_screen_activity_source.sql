ALTER TABLE member_screen_activity
  ADD COLUMN source text NOT NULL DEFAULT 'measured'
    CHECK (source IN ('measured', 'demo'));
