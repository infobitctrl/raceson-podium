const LEGACY_REPOSITORY = "infobitctrl/sitrail.com";
const RACESON_REPOSITORY = "infobitctrl/raceson.com";
const AUTHORIZED_REPOSITORIES = new Set([LEGACY_REPOSITORY, RACESON_REPOSITORY]);
const configuredRepository = process.env.RACESON_GITHUB_REPOSITORY?.trim();
const AUTHORIZED_REPOSITORY = configuredRepository && AUTHORIZED_REPOSITORIES.has(configuredRepository)
  ? configuredRepository
  : RACESON_REPOSITORY;
const REPOSITORY_API_URL = `https://api.github.com/repos/${AUTHORIZED_REPOSITORY}`;

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function authorizeGitHubWorkflowDispatch(
  token: string | null,
  fetcher: FetchLike = fetch,
) {
  const candidate = token?.trim() ?? "";
  if (candidate.length < 20 || candidate.length > 500 || /\s/.test(candidate)) {
    return false;
  }

  try {
    const response = await fetcher(REPOSITORY_API_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${candidate}`,
        "User-Agent": "raceson-staging-workflow-recovery",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;

    const repository = await response.json() as unknown;
    return isRecord(repository)
      && repository.full_name === AUTHORIZED_REPOSITORY
      && repository.private === true;
  } catch {
    return false;
  }
}

export function isStagingWorkflowHost(hostname: string) {
  return new Set([
    "staging.raceson.com",
    "raceson-staging.vercel.app",
    "sitrail-staging.vercel.app",
  ]).has(hostname.toLowerCase());
}
