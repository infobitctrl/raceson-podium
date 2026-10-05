export const MAP_TILES = {
  hybrid: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    label: "Hybrid",
    attribution: "Tiles &copy; Esri",
    overlayUrls: [
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    ],
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    label: "Topo",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | <a href="https://opentopomap.org">OpenTopoMap</a>',
    overlayUrls: [],
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    label: "Satellite",
    attribution: "Tiles &copy; Esri",
    overlayUrls: [],
  },
} as const;

export type MapTileKey = keyof typeof MAP_TILES;

export const MAP_TILE_KEYS = Object.keys(MAP_TILES) as MapTileKey[];
