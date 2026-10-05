import { getSupabaseBrowserClient } from "@/lib/supabase";

export const ACCOUNT_AVATAR_BUCKET = "user-avatars";
export const MAX_ACCOUNT_AVATAR_BYTES = 5 * 1024 * 1024;
export const ACCOUNT_AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateAccountAvatar(file: Pick<File, "size" | "type">) {
  if (!ACCOUNT_AVATAR_MIME_TYPES.includes(
    file.type as (typeof ACCOUNT_AVATAR_MIME_TYPES)[number],
  )) {
    return "Choose a JPG, PNG, or WebP image.";
  }
  if (file.size > MAX_ACCOUNT_AVATAR_BYTES) {
    return "Choose an image smaller than 5 MB.";
  }
  return null;
}

export async function uploadAccountAvatar(userId: string, file: File) {
  return uploadAccountImage(userId, file, "profile-image");
}

export async function uploadAccountCoverImage(userId: string, file: File) {
  return uploadAccountImage(userId, file, "profile-cover-image");
}

async function uploadAccountImage(userId: string, file: File, objectName: string) {
  const validationMessage = validateAccountAvatar(file);
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  const objectPath = `${userId}/${objectName}`;
  const { error } = await client.storage
    .from(ACCOUNT_AVATAR_BUCKET)
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    throw error;
  }

  const { data } = client.storage
    .from(ACCOUNT_AVATAR_BUCKET)
    .getPublicUrl(objectPath);

  if (!data.publicUrl) {
    throw new Error("The profile image was uploaded but no public URL was returned.");
  }

  return `${data.publicUrl}?v=${Date.now()}`;
}
