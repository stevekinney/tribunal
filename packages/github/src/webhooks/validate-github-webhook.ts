/**
 * GitHub webhook payload validation using github-webhook-schemas.
 *
 * This module re-exports type guards and types for the webhook events
 * that this application handles. Events not listed here are silently ignored.
 */

// Push event
export { isPushEvent, PushEventSchema, type PushEvent } from 'github-webhook-schemas/push-event';

// Pull request events (for extracting PR numbers)
export {
  isPullRequestOpenedEvent,
  PullRequestOpenedEventSchema,
  type PullRequestOpenedEvent,
} from 'github-webhook-schemas/pull-request-opened-event';
export {
  isPullRequestClosedEvent,
  PullRequestClosedEventSchema,
  type PullRequestClosedEvent,
} from 'github-webhook-schemas/pull-request-closed-event';
export {
  isPullRequestLabeledEvent,
  PullRequestLabeledEventSchema,
  type PullRequestLabeledEvent,
} from 'github-webhook-schemas/pull-request-labeled-event';
export {
  isPullRequestSynchronizeEvent,
  PullRequestSynchronizeEventSchema,
  type PullRequestSynchronizeEvent,
} from 'github-webhook-schemas/pull-request-synchronize-event';
export {
  isPullRequestConvertedToDraftEvent,
  PullRequestConvertedToDraftEventSchema,
  type PullRequestConvertedToDraftEvent,
} from 'github-webhook-schemas/pull-request-converted-to-draft-event';
export {
  isPullRequestReadyForReviewEvent,
  PullRequestReadyForReviewEventSchema,
  type PullRequestReadyForReviewEvent,
} from 'github-webhook-schemas/pull-request-ready-for-review-event';

// Pull request review events (for extracting PR numbers)
export {
  isPullRequestReviewSubmittedEvent,
  PullRequestReviewSubmittedEventSchema,
  type PullRequestReviewSubmittedEvent,
} from 'github-webhook-schemas/pull-request-review-submitted-event';

// Pull request review comment events (for extracting PR numbers)
export {
  isPullRequestReviewCommentCreatedEvent,
  PullRequestReviewCommentCreatedEventSchema,
  type PullRequestReviewCommentCreatedEvent,
} from 'github-webhook-schemas/pull-request-review-comment-created-event';
export {
  isPullRequestReviewCommentEditedEvent,
  PullRequestReviewCommentEditedEventSchema,
  type PullRequestReviewCommentEditedEvent,
} from 'github-webhook-schemas/pull-request-review-comment-edited-event';
export {
  isPullRequestReviewCommentDeletedEvent,
  PullRequestReviewCommentDeletedEventSchema,
  type PullRequestReviewCommentDeletedEvent,
} from 'github-webhook-schemas/pull-request-review-comment-deleted-event';

// Pull request review thread events (for task list state sync)
export {
  isPullRequestReviewThreadResolvedEvent,
  PullRequestReviewThreadResolvedEventSchema,
  type PullRequestReviewThreadResolvedEvent,
} from 'github-webhook-schemas/pull-request-review-thread-resolved-event';
export {
  isPullRequestReviewThreadUnresolvedEvent,
  PullRequestReviewThreadUnresolvedEventSchema,
  type PullRequestReviewThreadUnresolvedEvent,
} from 'github-webhook-schemas/pull-request-review-thread-unresolved-event';

// Issues events (for extracting issue numbers)
export {
  isIssuesOpenedEvent,
  IssuesOpenedEventSchema,
  type IssuesOpenedEvent,
} from 'github-webhook-schemas/issues-opened-event';
export {
  isIssuesClosedEvent,
  IssuesClosedEventSchema,
  type IssuesClosedEvent,
} from 'github-webhook-schemas/issues-closed-event';

// Issue comment events (for extracting issue numbers)
export {
  isIssueCommentCreatedEvent,
  IssueCommentCreatedEventSchema,
  type IssueCommentCreatedEvent,
} from 'github-webhook-schemas/issue-comment-created-event';
export {
  isIssueCommentEditedEvent,
  IssueCommentEditedEventSchema,
  type IssueCommentEditedEvent,
} from 'github-webhook-schemas/issue-comment-edited-event';
export {
  isIssueCommentDeletedEvent,
  IssueCommentDeletedEventSchema,
  type IssueCommentDeletedEvent,
} from 'github-webhook-schemas/issue-comment-deleted-event';

// Pull request reopened event (for orchestrator)
export {
  isPullRequestReopenedEvent,
  PullRequestReopenedEventSchema,
  type PullRequestReopenedEvent,
} from 'github-webhook-schemas/pull-request-reopened-event';

// Pull request review dismissed event (for orchestrator)
export {
  isPullRequestReviewDismissedEvent,
  PullRequestReviewDismissedEventSchema,
  type PullRequestReviewDismissedEvent,
} from 'github-webhook-schemas/pull-request-review-dismissed-event';

// Check run events (for extracting commit SHAs)
export {
  isCheckRunCompletedEvent,
  CheckRunCompletedEventSchema,
  type CheckRunCompletedEvent,
} from 'github-webhook-schemas/check-run-completed-event';

// Check suite events (for extracting commit SHAs)
export {
  isCheckSuiteCompletedEvent,
  CheckSuiteCompletedEventSchema,
  type CheckSuiteCompletedEvent,
} from 'github-webhook-schemas/check-suite-completed-event';

// Installation events
export {
  isInstallationCreatedEvent,
  InstallationCreatedEventSchema,
  type InstallationCreatedEvent,
} from 'github-webhook-schemas/installation-created-event';
export {
  isInstallationDeletedEvent,
  InstallationDeletedEventSchema,
  type InstallationDeletedEvent,
} from 'github-webhook-schemas/installation-deleted-event';
export {
  isInstallationSuspendEvent,
  InstallationSuspendEventSchema,
  type InstallationSuspendEvent,
} from 'github-webhook-schemas/installation-suspend-event';
export {
  isInstallationUnsuspendEvent,
  InstallationUnsuspendEventSchema,
  type InstallationUnsuspendEvent,
} from 'github-webhook-schemas/installation-unsuspend-event';
export {
  isInstallationNewPermissionsAcceptedEvent,
  InstallationNewPermissionsAcceptedEventSchema,
  type InstallationNewPermissionsAcceptedEvent,
} from 'github-webhook-schemas/installation-new-permissions-accepted-event';

// Installation repositories events (for cache invalidation)
export {
  isInstallationRepositoriesAddedEvent,
  InstallationRepositoriesAddedEventSchema,
  type InstallationRepositoriesAddedEvent,
} from 'github-webhook-schemas/installation-repositories-added-event';
export {
  isInstallationRepositoriesRemovedEvent,
  InstallationRepositoriesRemovedEventSchema,
  type InstallationRepositoriesRemovedEvent,
} from 'github-webhook-schemas/installation-repositories-removed-event';

// Repository events (for rename/transfer handling and cache invalidation)
export {
  isRepositoryRenamedEvent,
  RepositoryRenamedEventSchema,
  type RepositoryRenamedEvent,
} from 'github-webhook-schemas/repository-renamed-event';
export {
  isRepositoryTransferredEvent,
  RepositoryTransferredEventSchema,
  type RepositoryTransferredEvent,
} from 'github-webhook-schemas/repository-transferred-event';
export {
  isRepositoryEditedEvent,
  RepositoryEditedEventSchema,
  type RepositoryEditedEvent,
} from 'github-webhook-schemas/repository-edited-event';
export {
  isRepositoryPrivatizedEvent,
  RepositoryPrivatizedEventSchema,
  type RepositoryPrivatizedEvent,
} from 'github-webhook-schemas/repository-privatized-event';
export {
  isRepositoryPublicizedEvent,
  RepositoryPublicizedEventSchema,
  type RepositoryPublicizedEvent,
} from 'github-webhook-schemas/repository-publicized-event';
export {
  isRepositoryArchivedEvent,
  RepositoryArchivedEventSchema,
  type RepositoryArchivedEvent,
} from 'github-webhook-schemas/repository-archived-event';
export {
  isRepositoryUnarchivedEvent,
  RepositoryUnarchivedEventSchema,
  type RepositoryUnarchivedEvent,
} from 'github-webhook-schemas/repository-unarchived-event';
export {
  isRepositoryDeletedEvent,
  RepositoryDeletedEventSchema,
  type RepositoryDeletedEvent,
} from 'github-webhook-schemas/repository-deleted-event';

// Member events (for cache invalidation)
export {
  isMemberAddedEvent,
  MemberAddedEventSchema,
  type MemberAddedEvent,
} from 'github-webhook-schemas/member-added-event';
export {
  isMemberRemovedEvent,
  MemberRemovedEventSchema,
  type MemberRemovedEvent,
} from 'github-webhook-schemas/member-removed-event';
export {
  isMemberEditedEvent,
  MemberEditedEventSchema,
  type MemberEditedEvent,
} from 'github-webhook-schemas/member-edited-event';

// Team events (for cache invalidation)
export {
  isTeamAddedToRepositoryEvent,
  TeamAddedToRepositoryEventSchema,
  type TeamAddedToRepositoryEvent,
} from 'github-webhook-schemas/team-added-to-repository-event';
export {
  isTeamRemovedFromRepositoryEvent,
  TeamRemovedFromRepositoryEventSchema,
  type TeamRemovedFromRepositoryEvent,
} from 'github-webhook-schemas/team-removed-from-repository-event';

// Organization events (for cache invalidation)
export {
  isOrganizationMemberAddedEvent,
  OrganizationMemberAddedEventSchema,
  type OrganizationMemberAddedEvent,
} from 'github-webhook-schemas/organization-member-added-event';
export {
  isOrganizationMemberRemovedEvent,
  OrganizationMemberRemovedEventSchema,
  type OrganizationMemberRemovedEvent,
} from 'github-webhook-schemas/organization-member-removed-event';

// Membership events (for cache invalidation)
export {
  isMembershipAddedEvent,
  MembershipAddedEventSchema,
  type MembershipAddedEvent,
} from 'github-webhook-schemas/membership-added-event';
export {
  isMembershipRemovedEvent,
  MembershipRemovedEventSchema,
  type MembershipRemovedEvent,
} from 'github-webhook-schemas/membership-removed-event';

// GitHub app authorization events
export {
  isGithubAppAuthorizationRevokedEvent,
  GithubAppAuthorizationRevokedEventSchema,
  type GithubAppAuthorizationRevokedEvent,
} from 'github-webhook-schemas/github-app-authorization-revoked-event';

// Public event (deprecated but still used for cache invalidation)
export {
  isPublicEvent,
  PublicEventSchema,
  type PublicEvent,
} from 'github-webhook-schemas/public-event';

// Shared schemas
export { RepositorySchema, type Repository } from 'github-webhook-schemas/shared/repository';
export { UserSchema, type User } from 'github-webhook-schemas/shared/user';
