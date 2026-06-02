import { resolve } from '$app/paths';
import type { Pathname } from '$app/types';
import type { RouteParams } from '$app/types';

import type { RouteId } from '$app/types';

export type Tab = {
  label: string;
  path: string;
  active: boolean;
};

/**
 * Extract valid child route segments for a given RouteId base.
 * Uses distributive conditional to iterate over RouteId union.
 */
type ValidChild<
  Base extends RouteId | Pathname,
  R = RouteId | Pathname,
> = R extends `${Base}/${infer Child}`
  ? Child extends `${string}/${string}`
    ? never
    : Child
  : never;

type TabConfiguration<Base extends RouteId | Pathname> = {
  label: string;
  path?: ValidChild<Base>;
  /** Whether to show this tab. Can be a boolean or a getter function for reactivity. */
  show?: boolean | (() => boolean);
};

export type ResolveArgs<T extends RouteId | Pathname> = T extends RouteId
  ? RouteParams<T> extends Record<string, never>
    ? [route: T]
    : [route: T, params: RouteParams<T>]
  : [route: T];

const toResolveArgs = <P extends RouteId>(
  routeId: ResolveArgs<P>[0],
  parameters?: ResolveArgs<P>[1],
): ResolveArgs<P> => {
  return parameters ? ([routeId, parameters] as ResolveArgs<P>) : ([routeId] as ResolveArgs<P>);
};

const isActive = (base: string, tabPath: string, pathname: string): boolean => {
  if (base === tabPath) {
    return pathname === tabPath;
  } else {
    return pathname === tabPath || pathname.startsWith(`${tabPath}/`);
  }
};

/**
 * Creates reactive navigation tabs with type-safe relative paths.
 *
 * Returns an object with a reactive `current` getter that updates when the route changes.
 *
 * @param routeId - The RouteId pattern (e.g., '/(authenticated)/workspaces/[workspace=slug]')
 * @param tabs - Tab configurations with relative path segments
 *
 * @example
 * ```ts
 * const tabs = createTabs('/(authenticated)/workspaces/[workspace=slug]', [
 *   { label: 'Overview' },
 *   { label: 'Members', path: 'members' },
 *   { label: 'Settings', path: 'settings', show: ({ membership }) => membership.isAdmin },
 * ], () => data);
 *
 * // Use tabs.current in templates - it's reactive
 * <Page tabs={tabs.current}>
 * ```
 */
export function createTabs<const P extends RouteId>(
  routeId: ResolveArgs<P>[0],
  pathname: string,
  tabs: TabConfiguration<P>[],
  parameters: ResolveArgs<P>[1],
): Tab[] {
  // The conditional tuple type ResolveArgs<P> cannot be spread directly.
  // Cast through Parameters<typeof resolve> to maintain type safety at the call boundary.
  const base = resolve(
    ...(toResolveArgs(routeId, parameters) as unknown as Parameters<typeof resolve>),
  );

  return tabs
    .filter((tab) => {
      const show = typeof tab.show === 'function' ? tab.show() : tab.show;
      return show !== false;
    })
    .map((tab) => {
      const tabPath = tab.path === '' || tab.path === undefined ? base : `${base}/${tab.path}`;
      const active = isActive(base, tabPath, pathname);

      return {
        label: tab.label,
        path: tabPath,
        active,
      };
    });
}
