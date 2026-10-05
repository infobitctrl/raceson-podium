import { TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MAP_TILES } from "@/lib/map-tiles";
import { fitEventMapToContent } from "@/components/shared/eventMapViewport";
import StrictModeSafeMapContainer from "@/components/shared/StrictModeSafeMapContainer";

// Fix Leaflet default marker icon issue
const markerIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:28px;height:28px;border-radius:50%;background:hsl(25,95%,53%);border:3px solid hsl(220,20%,7%);box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -18],
});

const activeIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:36px;height:36px;border-radius:50%;background:hsl(25,95%,53%);border:3px solid white;box-shadow:0 0 20px rgba(230,120,30,0.5),0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -22],
});

export interface EventLocation {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  status?: string;
  date?: string;
  distance?: string;
  badgeLabel?: string;
}

export interface EventMapRoute {
  id: string;
  label: string;
  points: [number, number][];
  color: string;
}

interface EventLocationsMapProps {
  events: EventLocation[];
  routes?: EventMapRoute[];
  highlightId?: string;
  className?: string;
  onMarkerClick?: (id: string) => void;
  scrollWheelZoom?: boolean;
}

function EnsureEventMapInteractions({ scrollWheelZoom }: { scrollWheelZoom: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (scrollWheelZoom) {
      map.scrollWheelZoom.enable();
    } else {
      map.scrollWheelZoom.disable();
    }
    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    map.touchZoom.enable();
  }, [map, scrollWheelZoom]);

  return null;
}

function FitMapToEvents({ events, routes }: { events: EventLocation[]; routes: EventMapRoute[] }) {
  const map = useMap();

  useEffect(() => {
    fitEventMapToContent(map, events, routes);
  }, [events, map, routes]);

  return null;
}

function badgeClasses(status: string | undefined) {
  if (status === "open") {
    return { background: "#dcfce7", color: "#16a34a" };
  }
  if (status === "finished") {
    return { background: "#f1f5f9", color: "#64748b" };
  }
  if (status === "upcoming" || status === "sold_out") {
    return { background: "#dbeafe", color: "#2563eb" };
  }
  return { background: "#fff3e8", color: "#d97706" };
}

export default function EventLocationsMap({
  events,
  routes = [],
  highlightId,
  className = "",
  onMarkerClick,
  scrollWheelZoom = true,
}: EventLocationsMapProps) {
  // Center on Croatia/Balkans region
  const center: [number, number] = [44.0, 16.5];
  const hybridTile = MAP_TILES.hybrid;

  return (
    <div className={`rounded-xl border border-border overflow-hidden ${className}`}>
      <StrictModeSafeMapContainer
        center={center}
        zoom={7}
        style={{ height: "100%", width: "100%", minHeight: 420 }}
        scrollWheelZoom={scrollWheelZoom}
        dragging
        doubleClickZoom
        boxZoom
        keyboard
        touchZoom
        className="z-0"
      >
        <EnsureEventMapInteractions scrollWheelZoom={scrollWheelZoom} />
        <FitMapToEvents events={events} routes={routes} />
        <TileLayer
          attribution={hybridTile.attribution}
          url={hybridTile.url}
        />
        {hybridTile.overlayUrls.map((overlayUrl) => (
          <TileLayer
            key={overlayUrl}
            attribution={hybridTile.attribution}
            url={overlayUrl}
            opacity={0.92}
          />
        ))}
        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points}
            pathOptions={{ color: route.color, weight: 4, opacity: 0.9 }}
          >
            <Popup>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 12 }}>
                {route.label}
              </div>
            </Popup>
          </Polyline>
        ))}
        {events.map((event) => (
          <Marker
            key={event.id}
            position={[event.lat, event.lng]}
            icon={highlightId === event.id ? activeIcon : markerIcon}
            eventHandlers={{
              click: () => onMarkerClick?.(event.id),
            }}
          >
            <Popup>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", minWidth: 160 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "#1a1a2e" }}>{event.title}</div>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>
                  {[event.date, event.location].filter(Boolean).join(" · ")}
                </div>
                {event.distance ? (
                  <div style={{ fontSize: 11, color: "#666" }}>{event.distance}</div>
                ) : null}
                <div style={{ marginTop: 6 }}>
                  {(() => {
                    const tone = badgeClasses(event.status);
                    const badgeLabel = event.badgeLabel ?? event.status?.replace("_", " ") ?? "Location";
                    return (
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const,
                      padding: "2px 8px", borderRadius: 10,
                      background: tone.background,
                      color: tone.color,
                    }}>
                      {badgeLabel}
                    </span>
                    );
                  })()}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </StrictModeSafeMapContainer>
    </div>
  );
}
