ALTER TABLE "project" DROP CONSTRAINT "project_handle_not_reserved";--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_handle_not_reserved" CHECK (handle NOT IN (
        'new', 'create', 'edit', 'delete', 'update', 'remove',
        'settings', 'goals', 'questions', 'analysis', 'activity', 'analytics', 'files', 'branches',
        'commits', 'pulls', 'pull-requests', 'issues', 'releases', 'deployments',
        'environments', 'webhooks', 'api', 'export', 'archive', 'danger',
        'repositories', 'templates', 'github', 'linear', 'question-answer', 'chat',
        'agents', 'admin', 'null', 'undefined'
      ));
