-- 2026-06-29: meeting_records の permissive ポリシー穴を是正
-- （本番DBには Supabase Management 経由で適用済。本ファイルは記録/再現用・idempotent）
--
-- 旧状態: service_role_all が TO PUBLIC USING(true) だったため、authenticated に対し
--   meeting_records_tenant_isolation (tenant_id 一致) を OR 結合で打ち消し、
--   クロステナントの read/write を許していた（アプリ層フィルタだけが防御していた）。
-- 是正: TO service_role に絞る。service_role は元来 RLS をバイパスするため挙動不変であり、
--   authenticated には tenant_isolation のみが適用される（兄弟表 business_reports 等と同形）。
alter policy service_role_all on public.meeting_records to service_role;