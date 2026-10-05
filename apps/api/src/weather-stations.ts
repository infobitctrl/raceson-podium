export type PublicWeatherLocationInput = {
  id: string;
  lat: number;
  lng: number;
};

export type PublicWeatherCondition = "sunny" | "cloudy" | "rain" | "wind";

export type PublicWeatherLocationSnapshot = {
  locationId: string;
  stationCount: number;
  temp: number | null;
  humidity: number | null;
  windKph: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  condition: PublicWeatherCondition;
  conditionLabel: string;
  observationTime: string | null;
  stations: Array<{
    id: string;
    name: string;
    distanceKm: number;
  }>;
  errorMessage: string | null;
};

export type PublicWeatherSnapshotResponse = {
  provider: string;
  method: string;
  locations: PublicWeatherLocationSnapshot[];
};

type OpenMeteoCurrentResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    relative_humidity_2m_mean?: number[];
    wind_speed_10m_max?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
  };
};

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TARGET_TIME_ZONE = "Europe/Zagreb";
const OPEN_METEO_SOURCE = {
  id: "open-meteo",
  name: "Open-Meteo",
  distanceKm: 0,
} as const;

function buildDateKey(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function todayDateKey() {
  return buildDateKey(new Date());
}

function roundNumber(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeCondition(weatherCode: number | null, windKph: number | null, precipitationMm: number | null): PublicWeatherCondition {
  if ((precipitationMm ?? 0) > 0.1) return "rain";
  if ((windKph ?? 0) >= 32) return "wind";

  switch (weatherCode) {
    case 0:
    case 1:
      return "sunny";
    case 2:
    case 3:
    case 45:
    case 48:
      return "cloudy";
    default:
      if (weatherCode == null) return "cloudy";
      if (weatherCode >= 51 && weatherCode <= 99) return "rain";
      return "cloudy";
  }
}

function formatConditionLabel(weatherCode: number | null, windKph: number | null, precipitationMm: number | null) {
  if ((precipitationMm ?? 0) > 0.1) {
    if (weatherCode != null && weatherCode >= 95) return "Thunderstorm";
    if (weatherCode != null && weatherCode >= 80) return "Showers";
    if (weatherCode != null && weatherCode >= 71 && weatherCode <= 86) return "Snow / mixed";
    if (weatherCode != null && weatherCode >= 51) return "Rain";
  }

  if ((windKph ?? 0) >= 32) return "Windy";

  switch (weatherCode) {
    case 0:
      return "Clear sky";
    case 1:
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    default:
      return "Cloudy";
  }
}

function buildUnavailableSnapshot(locationId: string, errorMessage: string): PublicWeatherLocationSnapshot {
  return {
    locationId,
    stationCount: 0,
    temp: null,
    humidity: null,
    windKph: null,
    precipitationMm: null,
    precipitationProbability: null,
    condition: "cloudy",
    conditionLabel: "Unavailable",
    observationTime: null,
    stations: [],
    errorMessage,
  };
}

function buildOpenMeteoUrl(
  location: PublicWeatherLocationInput,
  params: Record<string, string>,
) {
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(location.lat));
  url.searchParams.set("longitude", String(location.lng));
  url.searchParams.set("timezone", TARGET_TIME_ZONE);
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Weather provider request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function getCurrentSnapshot(location: PublicWeatherLocationInput): Promise<PublicWeatherLocationSnapshot> {
  const data = await fetchJson<OpenMeteoCurrentResponse>(buildOpenMeteoUrl(location, {
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "wind_speed_10m",
      "precipitation",
      "weather_code",
    ].join(","),
  }));

  const current = data.current;
  if (!current) {
    return buildUnavailableSnapshot(location.id, "No current weather data is available for this location.");
  }

  const temp = roundNumber(current.temperature_2m);
  const humidity = roundNumber(current.relative_humidity_2m);
  const windKph = roundNumber(current.wind_speed_10m);
  const precipitationMm = roundNumber(current.precipitation, 1);
  const weatherCode = typeof current.weather_code === "number" ? current.weather_code : null;

  return {
    locationId: location.id,
    stationCount: 1,
    temp,
    humidity,
    windKph,
    precipitationMm,
    precipitationProbability: null,
    condition: normalizeCondition(weatherCode, windKph, precipitationMm),
    conditionLabel: formatConditionLabel(weatherCode, windKph, precipitationMm),
    observationTime: typeof current.time === "string" ? current.time : null,
    stations: [OPEN_METEO_SOURCE],
    errorMessage: null,
  };
}

async function getDailySnapshot(
  location: PublicWeatherLocationInput,
  targetDate: string,
): Promise<PublicWeatherLocationSnapshot> {
  const data = await fetchJson<OpenMeteoDailyResponse>(buildOpenMeteoUrl(location, {
    daily: [
      "weather_code",
      "temperature_2m_max",
      "relative_humidity_2m_mean",
      "wind_speed_10m_max",
      "precipitation_sum",
      "precipitation_probability_max",
    ].join(","),
    start_date: targetDate,
    end_date: targetDate,
  }));

  const daily = data.daily;
  if (!daily?.time?.length) {
    return buildUnavailableSnapshot(location.id, "No forecast data is available for the selected date.");
  }

  const weatherCode = typeof daily.weather_code?.[0] === "number" ? daily.weather_code[0] : null;
  const temp = roundNumber(daily.temperature_2m_max?.[0]);
  const humidity = roundNumber(daily.relative_humidity_2m_mean?.[0]);
  const windKph = roundNumber(daily.wind_speed_10m_max?.[0]);
  const precipitationMm = roundNumber(daily.precipitation_sum?.[0], 1);
  const precipitationProbability = roundNumber(daily.precipitation_probability_max?.[0]);

  return {
    locationId: location.id,
    stationCount: 1,
    temp,
    humidity,
    windKph,
    precipitationMm,
    precipitationProbability,
    condition: normalizeCondition(weatherCode, windKph, precipitationMm),
    conditionLabel: formatConditionLabel(weatherCode, windKph, precipitationMm),
    observationTime: null,
    stations: [OPEN_METEO_SOURCE],
    errorMessage: null,
  };
}

export async function getPublicWeatherSnapshots(
  locations: PublicWeatherLocationInput[],
  targetDate?: string,
): Promise<PublicWeatherSnapshotResponse> {
  const effectiveDate = targetDate ?? todayDateKey();
  const useDailyForecast = Boolean(targetDate);

  const snapshots = await Promise.all(
    locations.map(async (location) => {
      try {
        return useDailyForecast
          ? await getDailySnapshot(location, effectiveDate)
          : await getCurrentSnapshot(location);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Weather data is temporarily unavailable.";
        return buildUnavailableSnapshot(location.id, message);
      }
    }),
  );

  return {
    provider: "Open-Meteo",
    method: useDailyForecast
      ? "Daily forecast by route coordinates"
      : "Live current conditions by route coordinates",
    locations: snapshots,
  };
}
