-- Allow up to two file attachments per announcement.
alter table public.announcements
  add column if not exists file_url_2 text,
  add column if not exists file_name_2 text;
