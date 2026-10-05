import { TileLayer, Polyline, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import StrictModeSafeMapContainer from "@/components/shared/StrictModeSafeMapContainer";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { MAP_TILE_KEYS, MAP_TILES, type MapTileKey } from "@/lib/map-tiles";
import type { ElevPoint } from "@/components/shared/InteractiveElevation";
import { useI18n } from "@/shared/i18n/I18nContext";

interface Checkpoint {
  name: string;
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type?: string;
}

export interface TrackMapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  description?: string | null;
  color?: string;
}

interface TrackMapProps {
  trackPoints: [number, number][];
  checkpoints: Checkpoint[];
  elevations?: number[];
  interactivePoints?: ElevPoint[];
  highlightedTrackPoints?: [number, number][];
  highlightColor?: string;
  hoverPoint?: { lat: number; lng: number } | null;
  selectedPoint?: { lat: number; lng: number } | null;
  extraMarkers?: TrackMapMarker[];
  className?: string;
  showControls?: boolean;
  showCheckpointLabels?: boolean;
  minHeight?: number;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  onHoverRoutePoint?: (point: ElevPoint | null) => void;
  onCheckpointClick?: (checkpoint: Checkpoint) => void;
  defaultTileKey?: MapTileKey;
}

const TRACK_VIEWPORT_PADDING: [number, number] = [36, 36];
const TRACK_VIEWPORT_MAX_ZOOM = 17;

const startFinishIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:24px;height:24px;border-radius:50%;background:hsl(24,100%,48%);border:3px solid white;box-shadow:0 0 12px rgba(230,120,30,0.5);display:flex;align-items:center;justify-content:center;">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -16],
});

const cpIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:hsl(220,15%,8%);border:2px solid hsl(24,100%,48%);box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
    <div style="width:6px;height:6px;border-radius:50%;background:hsl(24,100%,48%)"></div>
  </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -14],
});

const hoverIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:hsl(24,100%,48%);border:3px solid white;box-shadow:0 0 16px rgba(230,120,30,0.6);animation:pulse 1.5s ease-in-out infinite;"></div>
  <style>@keyframes pulse{0%,100%{box-shadow:0 0 8px rgba(230,120,30,0.4)}50%{box-shadow:0 0 24px rgba(230,120,30,0.8)}}</style>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const selectedIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:20px;height:20px;border-radius:50%;background:hsl(220, 15%, 8%);border:3px solid hsl(24,100%,48%);box-shadow:0 0 18px rgba(230,120,30,0.55);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const runnerIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50%;background:hsl(155,55%,38%);border:3px solid white;box-shadow:0 0 16px rgba(50,180,100,0.5);display:flex;align-items:center;justify-content:center;">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="4" r="2.5"/><path d="M7 22l2-8 3 3 4-6 2 1-5 7-3-3-1.5 6z"/></svg>
  </div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function createAlertIcon(color = "hsl(0, 78%, 56%)") {
  return new L.DivIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 14px rgba(220,38,38,0.35);display:flex;align-items:center;justify-content:center;">
      <div style="width:7px;height:7px;border-radius:50%;background:white;"></div>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

function HoverMarker({ point }: { point: { lat: number; lng: number } | null }) {
  if (!point) return null;
  return <Marker position={[point.lat, point.lng]} icon={hoverIcon} interactive={false} keyboard={false} />;
}

function SelectedMarker({ point }: { point: { lat: number; lng: number } | null }) {
  if (!point) return null;
  return <Marker position={[point.lat, point.lng]} icon={selectedIcon} interactive={false} keyboard={false} />;
}

function MapClickHandler({ onMapClick }: { onMapClick?: (point: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(event) {
      onMapClick?.({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

function findNearestInteractivePoint(
  interactivePoints: ElevPoint[],
  point: { lat: number; lng: number },
) {
  return interactivePoints.reduce((closest, candidate) => {
    const candidateDistance =
      (candidate.lat - point.lat) * (candidate.lat - point.lat) +
      (candidate.lng - point.lng) * (candidate.lng - point.lng);
    if (!closest) {
      return { point: candidate, distance: candidateDistance };
    }
    return candidateDistance < closest.distance
      ? { point: candidate, distance: candidateDistance }
      : closest;
  }, null as { point: ElevPoint; distance: number } | null)?.point ?? null;
}

function MapHoverHandler({
  interactivePoints,
  onHoverRoutePoint,
}: {
  interactivePoints: ElevPoint[];
  onHoverRoutePoint?: (point: ElevPoint | null) => void;
}) {
  useMapEvents({
    mousemove(event) {
      if (!onHoverRoutePoint || !interactivePoints.length) return;
      onHoverRoutePoint(
        findNearestInteractivePoint(interactivePoints, {
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        }),
      );
    },
    mouseout() {
      onHoverRoutePoint?.(null);
    },
  });

  return null;
}

function AutoFitRouteBounds({
  trackPoints,
  checkpoints,
}: {
  trackPoints: [number, number][];
  checkpoints: Checkpoint[];
}) {
  const map = useMap();
  const routeViewport = useMemo(() => {
    const allPoints: [number, number][] = [
      ...trackPoints,
      ...checkpoints.map((checkpoint) => [checkpoint.lat, checkpoint.lng] as [number, number]),
    ];

    if (allPoints.length === 0) return null;

    let minLat = allPoints[0][0];
    let maxLat = allPoints[0][0];
    let minLng = allPoints[0][1];
    let maxLng = allPoints[0][1];

    allPoints.forEach(([lat, lng]) => {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    });

    return { minLat, maxLat, minLng, maxLng, pointCount: allPoints.length };
  }, [checkpoints, trackPoints]);

  const minLat = routeViewport?.minLat ?? null;
  const maxLat = routeViewport?.maxLat ?? null;
  const minLng = routeViewport?.minLng ?? null;
  const maxLng = routeViewport?.maxLng ?? null;
  const pointCount = routeViewport?.pointCount ?? 0;

  useEffect(() => {
    if (
      pointCount === 0
      || minLat === null
      || maxLat === null
      || minLng === null
      || maxLng === null
    ) return;

    const applyBounds = () => {
      map.invalidateSize(false);

      if (minLat === maxLat && minLng === maxLng) {
        map.setView([minLat, minLng], 14, { animate: false });
        return;
      }

      map.fitBounds(
        L.latLngBounds([
          [minLat, minLng],
          [maxLat, maxLng],
        ]),
        {
          padding: TRACK_VIEWPORT_PADDING,
          maxZoom: TRACK_VIEWPORT_MAX_ZOOM,
          animate: false,
        },
      );
    };

    const frameId = window.requestAnimationFrame(applyBounds);
    return () => window.cancelAnimationFrame(frameId);
  }, [map, maxLat, maxLng, minLat, minLng, pointCount]);

  return null;
}

function EnsureTrackMapInteractions() {
  const map = useMap();

  useEffect(() => {
    map.scrollWheelZoom.enable();
    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    map.touchZoom.enable();
  }, [map]);

  return null;
}

function RaceReplay({ trackPoints, playing, progress }: { trackPoints: [number, number][]; playing: boolean; progress: number }) {
  const idx = Math.min(Math.floor(progress * (trackPoints.length - 1)), trackPoints.length - 1);
  const pos = trackPoints[idx];
  if (!pos) return null;

  // Trail behind runner
  const trailPoints = trackPoints.slice(0, idx + 1);

  return (
    <>
      {trailPoints.length > 1 && (
        <Polyline
          positions={trailPoints}
          pathOptions={{ color: "hsl(155, 55%, 38%)", weight: 4, opacity: 0.7, lineCap: "round" }}
        />
      )}
      <Marker position={pos} icon={runnerIcon} interactive={false} keyboard={false} />
    </>
  );
}

export default function TrackMap({
  trackPoints,
  checkpoints,
  interactivePoints = [],
  highlightedTrackPoints = [],
  highlightColor = "hsl(var(--trail-blue))",
  hoverPoint,
  selectedPoint,
  extraMarkers = [],
  className = "",
  showControls = true,
  showCheckpointLabels = false,
  minHeight = 460,
  onMapClick,
  onHoverRoutePoint,
  onCheckpointClick,
  defaultTileKey = "topo",
}: TrackMapProps) {
  const { t } = useI18n();
  const midIdx = Math.floor(trackPoints.length / 2);
  const center: [number, number] = trackPoints[midIdx] || [44.3, 15.4];
  const hasRoute = trackPoints.length > 1;

  const [tileKey, setTileKey] = useState<MapTileKey>(defaultTileKey);

  useEffect(() => {
    setTileKey(defaultTileKey);
  }, [defaultTileKey]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const animRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const DURATION = 12000; // 12 seconds for full replay

  const animate = useCallback((time: number) => {
    if (!startTimeRef.current) startTimeRef.current = time;
    const elapsed = time - startTimeRef.current;
    const p = Math.min(elapsed / DURATION, 1);
    setProgress(p);
    if (p < 1) {
      animRef.current = requestAnimationFrame(animate);
    } else {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (playing) {
      startTimeRef.current = 0;
      animRef.current = requestAnimationFrame(animate);
    } else if (animRef.current) {
      cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, animate]);

  const resetReplay = () => { setPlaying(false); setProgress(0); };

  const tile = MAP_TILES[tileKey];

  return (
    <div className={`relative min-w-0 w-full max-w-full overflow-hidden rounded-xl border border-border ${className}`}>
      {hasRoute ? (
        <StrictModeSafeMapContainer
          center={center}
          zoom={11}
          style={{ height: "100%", width: "100%", minHeight }}
          scrollWheelZoom
          dragging
          doubleClickZoom
          boxZoom
          keyboard
          touchZoom
          className="z-0"
        >
          <EnsureTrackMapInteractions />
          <AutoFitRouteBounds trackPoints={trackPoints} checkpoints={checkpoints} />
          <MapClickHandler onMapClick={onMapClick} />
          <MapHoverHandler
            interactivePoints={interactivePoints}
            onHoverRoutePoint={onHoverRoutePoint}
          />
          <TileLayer
            key={tileKey}
            attribution={tile.attribution}
            url={tile.url}
          />
          {tile.overlayUrls.map((overlayUrl) => (
            <TileLayer
              key={`${tileKey}-${overlayUrl}`}
              attribution={tile.attribution}
              url={overlayUrl}
              opacity={0.92}
            />
          ))}

          <>
            <Polyline
              positions={trackPoints}
              pathOptions={{ color: "hsl(24, 100%, 48%)", weight: 12, opacity: 0.15, lineCap: "round" }}
            />
            <Polyline
              positions={trackPoints}
              pathOptions={{ color: "hsl(24, 100%, 48%)", weight: 4, opacity: 0.9, lineCap: "round", lineJoin: "round" }}
            />
          </>

          {highlightedTrackPoints.length > 1 ? (
            <>
              <Polyline
                positions={highlightedTrackPoints}
                pathOptions={{ color: highlightColor, weight: 12, opacity: 0.18, lineCap: "round" }}
              />
              <Polyline
                positions={highlightedTrackPoints}
                pathOptions={{ color: highlightColor, weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round" }}
              />
            </>
          ) : null}

          {checkpoints.map((cp) => (
            <Marker
              key={cp.name}
              title={cp.name}
              position={[cp.lat, cp.lng]}
              icon={cp.type === "start" || cp.type === "finish" ? startFinishIcon : cpIcon}
              eventHandlers={{
                click() {
                  onCheckpointClick?.(cp);
                },
              }}
            >
              {showCheckpointLabels && cp.type !== "start" && cp.type !== "finish" ? (
                <Tooltip permanent direction="top" offset={[0, -12]} opacity={0.94}>
                  {cp.name}
                </Tooltip>
              ) : null}
              <Popup>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#1a1a2e" }}>{cp.name}</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>km {cp.km} · {cp.elev}m elev</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {extraMarkers.map((marker) => (
            <Marker
              key={marker.id}
              title={marker.label}
              position={[marker.lat, marker.lng]}
              icon={createAlertIcon(marker.color)}
            >
              <Popup>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#1a1a2e" }}>{marker.label}</div>
                  {marker.description ? (
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4, lineHeight: 1.45 }}>
                      {marker.description}
                    </div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          ))}

          <HoverMarker point={hoverPoint ?? null} />
          <SelectedMarker point={selectedPoint ?? null} />
          {(playing || progress > 0) && (
            <RaceReplay trackPoints={trackPoints} playing={playing} progress={progress} />
          )}
        </StrictModeSafeMapContainer>
      ) : (
        <div className="flex h-full items-center justify-center bg-card px-6 text-center" style={{ minHeight }}>
          <div className="max-w-sm space-y-2">
            <div className="text-sm font-semibold text-foreground">Route preview will appear here</div>
            <p className="text-sm text-muted-foreground">
              Upload a GPX or save a route first to unlock the interactive map, station picking, and segment overlays.
            </p>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {showControls && hasRoute && (
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
          {/* Tile switcher */}
          <div className="flex rounded-lg border border-border bg-card/90 backdrop-blur-md overflow-hidden shadow-md">
            {MAP_TILE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTileKey(k)}
                className={`px-2.5 py-1.5 text-[10px] font-bold transition-colors ${
                  tileKey === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {MAP_TILES[k].label}
              </button>
            ))}
          </div>

          {/* Race replay */}
          <div className="flex rounded-lg border border-border bg-card/90 backdrop-blur-md overflow-hidden shadow-md">
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {playing ? "Pause" : "Replay"}
            </button>
            {progress > 0 && (
              <button
                type="button"
                onClick={resetReplay}
                aria-label={t("common.reset")}
                className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-muted/50 transition-colors border-l border-border"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Replay progress */}
          {(playing || progress > 0) && (
            <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full bg-trail-green transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
