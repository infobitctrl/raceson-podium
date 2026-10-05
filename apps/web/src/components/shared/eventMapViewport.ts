import L from "leaflet";

type MapPoint = { lat: number; lng: number };
type MapRoute = { points: [number, number][] };

export function fitEventMapToContent(
  map: Pick<L.Map, "fitBounds" | "setView">,
  events: MapPoint[],
  routes: MapRoute[],
) {
  const routePoints = routes.flatMap((route) => route.points);
  const allPoints = [
    ...events.map((event) => [event.lat, event.lng] as [number, number]),
    ...routePoints,
  ];
  if (!allPoints.length) return;

  // These maps are frequently replaced when a public event tab changes. A
  // pending Leaflet zoom transition can outlive the removed map pane and throw
  // from `_onZoomTransitionEnd`. Synchronous bounds updates keep tab changes
  // safe without changing the resulting viewport.
  if (allPoints.length === 1) {
    map.setView(allPoints[0], 14, { animate: false });
    return;
  }

  const bounds = L.latLngBounds(allPoints);
  map.fitBounds(bounds, { padding: [28, 28], animate: false });
}
