import type { QueryClient } from "@tanstack/react-query";
import type { PublicAthleteCatalogItem } from "@/lib/public-directory-read-models";

export const publicAthletesCatalogQueryKey = ["public-athletes-catalog"] as const;

export function stagePublicAthleteProfileCache(
  queryClient: QueryClient,
  input: {
    slug?: string | null;
    name: string;
    avatarUrl?: string | null;
    coverImageUrl?: string | null;
  },
) {
  if (!input.slug) return;

  queryClient.setQueryData<PublicAthleteCatalogItem[]>(
    publicAthletesCatalogQueryKey,
    (athletes) => athletes?.map((athlete) => athlete.id === input.slug
      ? {
          ...athlete,
          name: input.name,
          avatar: input.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || athlete.avatar,
          avatarUrl: input.avatarUrl ?? null,
          coverImageUrl: input.coverImageUrl ?? null,
        }
      : athlete),
  );

  void queryClient.invalidateQueries({
    queryKey: publicAthletesCatalogQueryKey,
    refetchType: "none",
  });
}
