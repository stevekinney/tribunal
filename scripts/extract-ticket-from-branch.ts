// extract-ticket-from-branch.ts
//
// Usage:
//   bun run scripts/extract-ticket-from-branch.ts [BRANCH_NAME]
//
// What it does:
//   - Extracts Linear ticket ID from branch name or current branch
//   - Supports patterns like:,-description, feature/-foo
//   - Outputs JSON with ticket info

import { error } from './lib/colors';

type TicketInfo = {
  found: boolean;
  ticketId: string | null;
  teamKey: string | null;
  ticketNumber: number | null;
  branch: string;
};

async function sh(cmd: string, args: string[]): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd: [cmd, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (spawnError) {
    throw new Error(`Failed to start command: ${cmd} ${args.join(' ')}\n${String(spawnError)}`);
  }

  const stdoutPromise = proc.stdout
    ? new Response(proc.stdout as ReadableStream).text()
    : Promise.resolve('');
  const stderrPromise = proc.stderr
    ? new Response(proc.stderr as ReadableStream).text()
    : Promise.resolve('');

  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, proc.exited]);

  if (exitCode !== 0) {
    const details = stderr.trim() || stdout.trim();
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}${details ? `\n${details}` : ''}`);
  }

  return stdout.trim();
}

async function getCurrentBranch(): Promise<string> {
  const branch = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') {
    throw new Error('Could not determine current branch (detached HEAD?).');
  }
  return branch;
}

function extractTicketFromBranch(branch: string): TicketInfo {
  // Match patterns like:
  // -, dep-123 (case-insensitive for branch names)
  // --some-description
  // - feature/-foo
  // - fix/
  // - claude/-bar
  const pattern = /\b([A-Za-z]{2,10})-(\d+)\b/i;
  const match = branch.match(pattern);

  if (match) {
    const [ticketId, teamKey, numberStr] = match;
    return {
      found: true,
      ticketId,
      teamKey,
      ticketNumber: parseInt(numberStr, 10),
      branch,
    };
  }

  return {
    found: false,
    ticketId: null,
    teamKey: null,
    ticketNumber: null,
    branch,
  };
}

async function getRecentCommitTickets(): Promise<string[]> {
  // Also check recent commits for ticket references
  try {
    const log = await sh('git', ['log', '--oneline', '-10', '--format=%s']);
    const tickets: string[] = [];
    const pattern = /\b([A-Za-z]{2,10}-\d+)\b/gi;

    for (const line of log.split('\n')) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        if (!tickets.includes(match[1])) {
          tickets.push(match[1]);
        }
      }
    }

    return tickets;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const branchArg = Bun.argv[2];
  const branch = branchArg ?? (await getCurrentBranch());

  const ticketInfo = extractTicketFromBranch(branch);

  // If not found in branch, check recent commits
  let commitTickets: string[] = [];
  if (!ticketInfo.found) {
    commitTickets = await getRecentCommitTickets();
  }

  // Output as JSON for easy parsing
  const output = {
    ...ticketInfo,
    commitTickets,
  };

  if (output.found) {
    console.log(output.ticketId);
  } else {
    console.log('No ticket found');
  }
}

main().catch((err) => {
  console.error(error(String(err?.stack ?? err)));
  process.exit(1);
});
