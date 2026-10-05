import type {
  PortalEventGalleryItem,
  PortalEventVideo,
} from "@/lib/portal-data";

export type LegacyEventMedia = {
  gallery: PortalEventGalleryItem[];
  videos: PortalEventVideo[];
};

const createNumberedGallery = ({
  eventSlug,
  filePrefix,
  fileExtension,
  photoCount,
  caption,
}: {
  eventSlug: string;
  filePrefix: string;
  fileExtension: (number: number) => string;
  photoCount: number;
  caption: (number: number) => string;
}): PortalEventGalleryItem[] => Array.from({ length: photoCount }, (_, index) => {
  const number = index + 1;
  const paddedNumber = String(number).padStart(2, "0");

  return {
    id: `${eventSlug}-photo-${paddedNumber}`,
    imageUrl: `/event-media/${eventSlug}/${filePrefix}-${paddedNumber}.${fileExtension(number)}`,
    caption: caption(number),
  };
});

const torakGallery = createNumberedGallery({
  eventSlug: "torak-2026",
  filePrefix: "torak-gallery",
  fileExtension: (number) => number <= 10 ? "jpg" : "jpeg",
  photoCount: 42,
  caption: (number) => `Torak Trail 2026 race photo ${number}`,
});

const trtarGallery = createNumberedGallery({
  eventSlug: "trtar-2026",
  filePrefix: "trtar-gallery",
  fileExtension: () => "jpeg",
  photoCount: 9,
  caption: (number) => `Trtar Trail 2026 race photo ${number}`,
});

const vrpoljeLegacyGallery: PortalEventGalleryItem[] = [
  { number: 1, extension: "jpeg", width: 1500, height: 2000, caption: "Runners at the opening Vrpolje round" },
  ...Array.from({ length: 5 }, (_, index) => ({
    number: index + 2,
    extension: "jpg",
    width: 2000,
    height: 2000,
    caption: `Vrpolje race-day atmosphere ${index + 1}`,
  })),
  ...Array.from({ length: 24 }, (_, index) => ({
    number: index + 7,
    extension: "jpeg",
    width: [18, 26, 29].includes(index + 7) ? 2040 : 1530,
    height: [18, 26, 29].includes(index + 7) ? 1530 : 2040,
    caption: `Runners on the Vrpolje route ${index + 1}`,
  })),
  { number: 32, extension: "jpeg", width: 2040, height: 1530, caption: "Vrpolje start-line atmosphere" },
].map((item) => ({
  id: `vrpolje-${String(item.number).padStart(2, "0")}`,
  imageUrl: `https://sitrail.com/slike/vrpolje-2026/vrpolje-${String(item.number).padStart(2, "0")}.${item.extension}`,
  caption: item.caption,
  width: item.width,
  height: item.height,
}));

export const legacyEventMedia: Record<string, LegacyEventMedia> = {
  "vrpolje-trail-2026-2026": {
    gallery: vrpoljeLegacyGallery,
    videos: [{
      id: "vrpolje-2026-race-film",
      url: "https://sitrail.com/video/vrpolje-2026/vrpolje-31.mp4",
      title: "Vrpolje Trail 2026 race film",
      posterUrl: "https://sitrail.com/slike/vrpolje-2026/vrpolje-32.jpeg",
    }],
  },
  "torak-trail-2026": {
    gallery: torakGallery,
    videos: [{
      id: "torak-2026-race-start",
      url: "https://www.youtube.com/watch?v=gHRIEuUBwwo",
      title: "Torak Trail 2026 — start of the second Šibenik Trail League round",
    }],
  },
  "trtarski-krug-2026": {
    gallery: trtarGallery,
    videos: [{
      id: "trtar-2026-five-kilometre-start",
      url: "https://www.youtube.com/watch?v=CcP3R50R1w4",
      title: "Trtar Trail 2026 — 5 km race start",
    }],
  },
};
