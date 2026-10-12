import { describe, expect, it } from "vitest";
import { croatianApplicationCopy } from "./applicationCopyTranslations";
import { croatianMessages, englishMessages } from "./messages";

describe("route terminology", () => {
  const removeApprovedTrackVerbs = (value: string) => value
    .replace(/\bTrack the\b/g, "Follow the")
    .replace(/\bTrack expected\b/g, "Follow expected")
    .replace(/\bTrack participation\b/g, "Follow participation")
    .replace(/\bTrack entries\b/g, "Follow entries")
    .replace(/\btrack its\b/g, "follow its")
    .replace(/\btracks only\b/g, "follows only");
  const removeTemplatePlaceholders = (value: string) => value.replace(/\{[^}]+\}/g, "");

  it("uses Routes in English public and shared navigation copy", () => {
    expect(englishMessages["common.track"]).toBe("Route");
    expect(englishMessages["common.tracks"]).toBe("Routes");
    expect(englishMessages["nav.tracks"]).toBe("Routes");
    expect(englishMessages["tracks.hero.title"]).toBe("Explore routes");
    expect(englishMessages["tracks.searchPlaceholder"]).toContain("routes");
  });

  it("uses Rute in Croatian public, athlete, and organizer copy", () => {
    expect(croatianMessages["common.track"]).toBe("Ruta");
    expect(croatianMessages["common.tracks"]).toBe("Rute");
    expect(croatianMessages["nav.tracks"]).toBe("Rute");
    expect(croatianMessages["tracks.hero.title"]).toBe("Istraži rute");
    expect(croatianMessages["tracks.searchPlaceholder"]).toContain("rute");
    expect(croatianApplicationCopy.Routes).toBe("Rute");
    expect(croatianApplicationCopy["Route Type"]).toBe("Vrsta rute");
    expect(croatianApplicationCopy["Saved Routes"]).toBe("Spremljene rute");
  });

  it("does not expose the rejected Trase label in route copy", () => {
    const routeMessages = Object.entries(croatianMessages)
      .filter(([key]) => key === "common.track" || key === "common.tracks" || key === "nav.tracks" || key.startsWith("tracks."))
      .map(([, value]) => value)
      .join(" ");

    expect(routeMessages).not.toMatch(/\btras(?:a|e|i|u|om|ama)\b/i);
    expect(Object.values(croatianApplicationCopy).join(" ")).not.toMatch(/\btras(?:a|e|i|u|om|ama)\b/i);
  });

  it("does not expose Course or Track as English portal nouns", () => {
    for (const value of Object.values(englishMessages)) {
      expect(removeApprovedTrackVerbs(removeTemplatePlaceholders(value))).not.toMatch(/\b(?:course|courses|track|tracks)\b/i);
    }
    for (const key of Object.keys(croatianApplicationCopy)) {
      if (key === "event" || key === "track") continue;
      expect(removeApprovedTrackVerbs(key)).not.toMatch(/\b(?:course|courses|track|tracks)\b/i);
    }
  });

  it("does not expose Event as the Race entity in application copy", () => {
    // Podium sponsors select an event containing races; this is a distinct entity.
    for (const [key, value] of Object.entries(englishMessages)) {
      if (key.startsWith("rewards.") || key.startsWith("podium.")) continue;
      expect(removeTemplatePlaceholders(value)).not.toMatch(/\b(?:event|events)\b/i);
    }
    for (const key of Object.keys(croatianApplicationCopy)) {
      if (key === "event") continue;
      expect(key).not.toMatch(/\b(?:event|events)\b/i);
    }
    expect(Object.values(croatianApplicationCopy).join(" ")).not.toMatch(/\bdogađaj(?:a|u|em|i|e|ima)?\b/i);
  });

  it("uses Races and Utrke across shared race-facing copy", () => {
    expect(englishMessages["nav.events"]).toBe("Races");
    expect(englishMessages["events.hero.eyebrow"]).toBe("Race calendar");
    expect(englishMessages["events.found"].toLowerCase()).toContain("races");
    expect(englishMessages["workspace.organizerDescription"]).toBe("Manage races and race day");
    expect(croatianMessages["nav.events"]).toBe("Utrke");
    expect(croatianMessages["events.hero.eyebrow"]).toBe("Kalendar utrka");
    expect(croatianMessages["events.found"]).toContain("utrka");
    expect(croatianMessages["workspace.organizerDescription"]).toBe("Upravljaj utrkama i danom utrke");
  });

  it("does not expose Races, Utrke, or doubled race nouns in shared race-facing copy", () => {
    const prefixes = ["athlete.", "stats.", "event.", "race.", "results.", "events.", "workspace.", "registration.", "home.", "league.", "organizer."];
    const collect = (messages: Record<string, string>) => Object.entries(messages)
      .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)))
      .map(([, value]) => value.replace(/\{events?\}/g, ""));

    for (const value of collect(englishMessages)) {
      expect(value).not.toMatch(/\bevents?\b/i);
      expect(value).not.toMatch(/\brace\s+races\b/i);
    }
    for (const value of collect(croatianMessages)) {
      expect(value).not.toMatch(/\bdogađaj(?:a|i|e|u|em|ima)?\b/i);
      expect(value).not.toMatch(/\butrk(?:a|e|u|om|ama)\s+utrke\b/i);
    }
  });
});
