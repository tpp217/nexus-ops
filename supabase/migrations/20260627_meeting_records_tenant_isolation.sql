-- =====================================================================
-- meeting_records テナント分離（多層防御）
--
-- 目的:
--   nexus-ops は静的サイト＋Vercel Functions（api/*.js）で、Supabase を
--   service-role で直叩きしている。service-role は RLS をバイパスするため、
--   テナント分離の「主たる防御」はアプリ層（api/* と server.js で tenant_id を
--   必ずクエリに付与する）。本 migration はそれを支える DB 側の土台:
--     1) tenant_id 列の追加（additive）
--     2) 既存行を utinc テナントへ backfill
--     3) tenant_id 索引
--     4) 一意制約を (sheet_name, source_file) → (tenant_id, sheet_name, source_file)
--        へ付け替え（別テナントが同じ sheet_name+source_file を持てるように）
--     5) RLS のテナントポリシー（service-role 以外の経路に対する多層防御）
--
-- 安全性:
--   - すべて additive / 既存挙動を壊さない。1 トランザクション。
--   - utinc テナント ID = '993aba82-bfa2-4fc8-ada9-928e2875120f'（実データは全て utinc）。
--   - 適用先 DB: ops プロジェクト（urzflutzgcioqswzmpkz）/ public.meeting_records。
--   - 本 migration は PR では「未適用」。親が ops 本番へ手動適用する。
-- =====================================================================

begin;

-- 1) tenant_id 列（再実行可能）
alter table public.meeting_records
  add column if not exists tenant_id text;

-- 2) 既存行を utinc へ backfill（NULL のものだけ。再実行しても無害）
update public.meeting_records
   set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f'
 where tenant_id is null;

-- 3) tenant_id 索引（テナント絞り込みの常用クエリ用）
create index if not exists idx_meeting_records_tenant_id
  on public.meeting_records (tenant_id);

-- 4) 一意制約の付け替え
--    旧: UNIQUE (sheet_name, source_file)  … テナント横断で衝突＝別テナントが同一
--        sheet_name+source_file を持てない。アプリ層 upsert の onConflict もこれに依存。
--    新: UNIQUE (tenant_id, sheet_name, source_file) … テナント内でのみ一意。
--    アプリ層 upsert は onConflict を 'tenant_id,sheet_name,source_file' に変更する。
alter table public.meeting_records
  drop constraint if exists meeting_records_sheet_name_source_file_key;

-- 既存の重複が無いことは確認済み（全行 utinc・元制約で一意だったため衝突しない）。
alter table public.meeting_records
  add constraint meeting_records_tenant_sheet_source_key
  unique (tenant_id, sheet_name, source_file);

-- 5) RLS（多層防御）。service-role はバイパスするため、これは
--    将来 authenticated JWT 経由（PostgREST 等）でアクセスした場合の保険。
--    既に RLS は有効化済み。tenant ポリシーのみ追加（再実行可能に drop→create）。
alter table public.meeting_records enable row level security;

drop policy if exists meeting_records_tenant_isolation on public.meeting_records;
create policy meeting_records_tenant_isolation
  on public.meeting_records
  for all
  to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id'));

commit;
