import { uploadTrackGalleryFiles } from "@/lib/track-storage";

export async function uploadLeagueImage(organizationId: string, file: File) {
  const [uploaded] = await uploadTrackGalleryFiles(organizationId, [file]);
  if (!uploaded?.imageUrl) throw new Error("The league image could not be uploaded.");
  return uploaded.imageUrl;
}
