export type EventDetailQueryScope = {
  categoryTracks: boolean;
  courseGeometry: boolean;
  participantRows: boolean;
  publicLiveState: boolean;
  raceDayTrack: boolean;
  results: boolean;
  resultsTrack: boolean;
  selectedRaceTrack: boolean;
};

export function getEventDetailQueryScope(
  activeTab: string,
  categorySlugs: string[],
): EventDetailQueryScope {
  const isCategoryView = categorySlugs.includes(activeTab) || (activeTab === "Race info" && categorySlugs.length > 0);
  const isResultsView = activeTab === "Results";
  const isLiveView = activeTab === "Live";

  return {
    categoryTracks: isCategoryView,
    courseGeometry: isCategoryView
      || isLiveView
      || activeTab === "Results"
      || activeTab === "Rules",
    participantRows: isCategoryView
      || activeTab === "Registrations"
      || isResultsView
      || activeTab === "Statistics",
    publicLiveState: isLiveView,
    raceDayTrack: isLiveView,
    results: isCategoryView || isResultsView,
    resultsTrack: isResultsView,
    selectedRaceTrack: isCategoryView,
  };
}
