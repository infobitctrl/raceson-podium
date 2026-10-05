import { apiRequest } from "@/lib/api";

export type LiveWeatherCondition = "sunny" | "cloudy" | "rain" | "wind";

export type LiveWeatherSnapshot = {
  locationId: string;
  stationCount: number;
  temp: number | null;
  humidity: number | null;
  windKph: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  condition: LiveWeatherCondition;
  conditionLabel: string;
  observationTime: string | null;
  stations: Array<{
    id: string;
    name: string;
    distanceKm: number;
  }>;
  errorMessage: string | null;
};

export type LiveWeatherResponse = {
  provider: string;
  method: string;
  locations: LiveWeatherSnapshot[];
};

class LocalWeatherHttpError extends Error {}

function buildUnavailableWeatherSnapshot(locationId: string): LiveWeatherSnapshot {
  return {
    locationId,
    stationCount: 0,
    temp: null,
    humidity: null,
    windKph: null,
    precipitationMm: null,
    precipitationProbability: null,
    condition: "cloudy",
    conditionLabel: "Weather unavailable",
    observationTime: null,
    stations: [],
    errorMessage: "Live weather is temporarily unavailable.",
  };
}

function getLocalWeatherApiUrls() {
  if (typeof window === "undefined" || !window.location) return [];
  const hostname = window.location.hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return [];
  const alternateHost = hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  return [
    `http://${hostname}:8787/api/v1/public/weather-snapshots`,
    `http://${alternateHost}:8787/api/v1/public/weather-snapshots`,
  ];
}

async function requestLocalLiveWeather(
  urls: string[],
  body: {
    locations: Array<{ id: string; lat: number; lng: number }>;
    date?: string;
  },
) {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new LocalWeatherHttpError(`Weather request failed with ${response.status}`);
      }
      const payload = (await response.json().catch(() => null)) as LiveWeatherResponse | { data?: LiveWeatherResponse } | null;
      if (payload && typeof payload === "object" && "data" in payload && payload.data) {
        return payload.data;
      }
      return payload as LiveWeatherResponse;
    } catch (error) {
      if (error instanceof LocalWeatherHttpError) throw error;
      lastError = error;
    }
  }
  throw (lastError instanceof Error ? lastError : new Error("Live weather request failed"));
}

export async function getLiveWeatherSnapshots(
  locations: Array<{
    id: string;
    lat: number;
    lng: number;
  }>,
  date?: string | null,
) {
  if (!locations.length) {
    return {
      provider: "Open-Meteo",
      method: "Forecast by route coordinates",
      locations: [],
    } satisfies LiveWeatherResponse;
  }

  const body = {
    locations,
    ...(date ? { date } : {}),
  };
  const localWeatherApiUrls = getLocalWeatherApiUrls();

  try {
    if (localWeatherApiUrls.length) {
      return await requestLocalLiveWeather(localWeatherApiUrls, body);
    }
    return await apiRequest<LiveWeatherResponse>({
      path: "/v1/public/weather-snapshots",
      method: "POST",
      body,
    });
  } catch (error) {
    console.warn("Live weather request failed; falling back to unavailable snapshots.", error);
    return {
      provider: "Open-Meteo",
      method: "Forecast by route coordinates",
      locations: locations.map((location) => buildUnavailableWeatherSnapshot(location.id)),
    } satisfies LiveWeatherResponse;
  }
}
