/**
 * Repository factory for creating test repositories.
 */
import { repository } from '@tribunal/database/schema';
import type { Repository } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type RepositoryFactoryInput = Partial<{
  id: number;
  owner: string;
  name: string;
  uri: string;
  defaultBranch: string;
  commit: string;
  installationId: number | null;
}>;

export interface RepositoryFactory {
  /** Create a repository */
  create(input?: RepositoryFactoryInput): Promise<Repository>;
}

export function createRepositoryFactory(db: Database): RepositoryFactory {
  return {
    async create(input = {}) {
      const id = input.id ?? generateId() + 100000000;
      const owner = input.owner ?? `test-owner-${id}`;
      const name = input.name ?? `test-repo-${id}`;

      const [repo] = await db
        .insert(repository)
        .values({
          id,
          owner,
          name,
          uri: input.uri ?? `https://github.com/${owner}/${name}.git`,
          defaultBranch: input.defaultBranch ?? null,
          commit: input.commit ?? null,
          installationId: input.installationId ?? null,
        })
        .returning();
      return repo;
    },
  };
}
