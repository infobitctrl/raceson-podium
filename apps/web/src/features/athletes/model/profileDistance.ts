export function sumAthleteResultDistanceKm(
  results: Array<{ distanceKm: number | null }>,
) {
  const total = results.reduce((sum, result) => {
    const distanceKm = result.distanceKm;
    return typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm > 0
      ? sum + distanceKm
      : sum;
  }, 0);

  return Math.round(total * 100) / 100;
}
