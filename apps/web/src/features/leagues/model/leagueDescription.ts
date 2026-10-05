const leaguePlanningMetadataPattern = /(?:^|\s)(?:About the League|League Image|Round Plan|Scoring|Standings|Operations|Closeout):/i;

export type LeaguePlanningDescriptionMetadata = {
  roundPlan: string | null;
  scoring: string | null;
  standings: string | null;
  operations: string | null;
  closeout: string | null;
};

const leaguePlanningMetadataKeys = {
  "round plan": "roundPlan",
  scoring: "scoring",
  standings: "standings",
  operations: "operations",
  closeout: "closeout",
} as const satisfies Record<string, keyof LeaguePlanningDescriptionMetadata>;

export function getLeaguePlanningDescriptionMetadata(
  description: string | null | undefined,
): LeaguePlanningDescriptionMetadata {
  const metadata: LeaguePlanningDescriptionMetadata = {
    roundPlan: null,
    scoring: null,
    standings: null,
    operations: null,
    closeout: null,
  };

  for (const line of (description ?? "").split("\n")) {
    const match = line.trim().match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = leaguePlanningMetadataKeys[match[1].trim().toLowerCase() as keyof typeof leaguePlanningMetadataKeys];
    if (key) metadata[key] = match[2].trim();
  }

  return metadata;
}

export function getLeagueAboutDescription(description: string | null | undefined) {
  const match = (description ?? "").match(/^About the League:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export function summarizeLeagueDescription(
  description: string | null | undefined,
  fallback: string,
  maxLength = 180,
) {
  const normalized = (description ?? "").replace(/\s+/g, " ").trim();
  const metadataStart = normalized.search(leaguePlanningMetadataPattern);
  const publicBrief = (metadataStart >= 0 ? normalized.slice(0, metadataStart) : normalized)
    .replace(/^Season Brief:\s*/i, "")
    .trim();
  const source = publicBrief || fallback.trim();
  const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [source];
  const concise = sentences.slice(0, 2).map((sentence) => sentence.trim()).join(" ");

  if (concise.length <= maxLength) return concise;
  return `${concise.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
