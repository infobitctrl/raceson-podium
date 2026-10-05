export type BrandConfig = {
  name: "RacesOn";
  campaignMotto: "Races On.";
  supportingLine: "Races are on. Are you in?";
  domain: "www.raceson.com";
  origin: "https://www.raceson.com";
  stagingOrigin: "https://staging.raceson.com";
  description: string;
  organizerPromise: string;
  athletePromise: string;
  supportEmail: string;
  legalEntityStatus: "unchanged";
  colors: {
    raceInk: "#0B1116";
    mineral: "#F3F1EA";
    raceOrange: "#F56200";
    timingLime: "#D8FF22";
    adriaticBlue: "#1E6BFF";
    contour: "#25313A";
  };
};

export const brand: BrandConfig = {
  name: "RacesOn",
  campaignMotto: "Races On.",
  supportingLine: "Races are on. Are you in?",
  domain: "www.raceson.com",
  origin: "https://www.raceson.com",
  stagingOrigin: "https://staging.raceson.com",
  description:
    "One connected platform for organizers, athletes, clubs, and leagues—create races, manage registrations and race day, explore routes, and publish official results.",
  organizerPromise:
    "Publish, register, operate, and verify every race from one connected workspace.",
  athletePromise:
    "Find the start line, register once, follow the race, and keep every official result.",
  supportEmail: "info@raceson.com",
  legalEntityStatus: "unchanged",
  colors: {
    raceInk: "#0B1116",
    mineral: "#F3F1EA",
    raceOrange: "#F56200",
    timingLime: "#D8FF22",
    adriaticBlue: "#1E6BFF",
    contour: "#25313A",
  },
};

export const legacyBrand = {
  name: "SiTRAIL",
  domain: "sitrail.com",
} as const;
