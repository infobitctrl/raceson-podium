alter table event_categories
  add column if not exists parking_label text,
  add column if not exists organizer_notes text;
