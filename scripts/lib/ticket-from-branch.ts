export type TicketInfo = {
  found: boolean;
  ticketId: string | null;
  teamKey: string | null;
  ticketNumber: number | null;
  branch: string;
};

export function extractTicketFromBranch(branch: string): TicketInfo {
  const pattern = /\b([A-Za-z]{2,10})-(\d+)\b/i;
  const match = branch.match(pattern);

  if (match) {
    const [ticketId, teamKey, numberString] = match;
    return {
      found: true,
      ticketId,
      teamKey,
      ticketNumber: Number.parseInt(numberString, 10),
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
