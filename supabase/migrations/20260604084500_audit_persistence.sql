create table if not exists public.audit_json_documents (
  document_key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_upload_objects (
  storage_key text primary key,
  content_type text not null,
  bytes_base64 text not null,
  updated_at timestamptz not null default now()
);

alter table public.audit_json_documents enable row level security;
alter table public.audit_upload_objects enable row level security;

revoke all on table public.audit_json_documents from anon, authenticated;
revoke all on table public.audit_upload_objects from anon, authenticated;

grant select, insert, update, delete on table public.audit_json_documents to service_role;
grant select, insert, update, delete on table public.audit_upload_objects to service_role;
