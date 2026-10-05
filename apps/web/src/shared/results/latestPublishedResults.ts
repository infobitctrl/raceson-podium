export type PublishedResultPublicationSource = {
  id: string;
  eventCategoryId: string;
  resultRunId: string;
  publicationState: string;
  publishedAt: string;
  createdAt: string;
};

export function selectLatestPublishedResults<
  TResult extends { eventCategoryId: string; resultRunId: string },
>(input: {
  resultRows: TResult[];
  publications: PublishedResultPublicationSource[];
}) {
  const latestPublicationByCategory = new Map<string, PublishedResultPublicationSource>();

  for (const publication of input.publications) {
    if (publication.publicationState !== "official" && publication.publicationState !== "corrected") continue;
    const current = latestPublicationByCategory.get(publication.eventCategoryId);
    if (
      !current
      || publication.publishedAt > current.publishedAt
      || (publication.publishedAt === current.publishedAt && publication.createdAt > current.createdAt)
      || (
        publication.publishedAt === current.publishedAt
        && publication.createdAt === current.createdAt
        && publication.id > current.id
      )
    ) {
      latestPublicationByCategory.set(publication.eventCategoryId, publication);
    }
  }

  return input.resultRows.filter((result) => (
    latestPublicationByCategory.get(result.eventCategoryId)?.resultRunId === result.resultRunId
  ));
}
