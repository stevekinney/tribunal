UPDATE sandbox_lifecycle_event
SET workflow_id = COALESCE(workflow_id, 'unknown-pre-mvp'),
    task_queue = COALESCE(task_queue, 'unknown-pre-mvp')
WHERE workflow_id IS NULL OR task_queue IS NULL;

UPDATE sandbox_lifecycle_snapshot
SET workflow_id = COALESCE(workflow_id, 'unknown-pre-mvp'),
    task_queue = COALESCE(task_queue, 'unknown-pre-mvp')
WHERE workflow_id IS NULL OR task_queue IS NULL;

ALTER TABLE sandbox_lifecycle_event
  ALTER COLUMN workflow_id SET NOT NULL,
  ALTER COLUMN task_queue SET NOT NULL;

ALTER TABLE sandbox_lifecycle_snapshot
  ALTER COLUMN workflow_id SET NOT NULL,
  ALTER COLUMN task_queue SET NOT NULL;
