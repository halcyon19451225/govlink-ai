-- module_artifacts の upsert に必要な一意制約を追加
-- recordArtifact ヘルパの ON CONFLICT (project_id, module_id, artifact_record_id) が使う
ALTER TABLE module_artifacts
  ADD CONSTRAINT module_artifacts_project_module_record_unique
  UNIQUE (project_id, module_id, artifact_record_id);
