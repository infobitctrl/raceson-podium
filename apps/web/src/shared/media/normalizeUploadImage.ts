export const DEFAULT_UPLOAD_IMAGE_MAX_DIMENSION = 2_560;
export const DEFAULT_UPLOAD_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;

const DEFAULT_WEBP_QUALITIES = [0.82, 0.74, 0.66] as const;

type DecodedUploadImage = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close: () => void;
};

export type UploadImageProcessor = {
  decode: (file: File) => Promise<DecodedUploadImage>;
  encodeWebp: (
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ) => Promise<Blob>;
};

export type UploadImageNormalizationOptions = {
  maxDimension?: number;
  targetBytes?: number;
  qualities?: readonly number[];
};

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export function scaledUploadImageDimensions(
  width: number,
  height: number,
  maxDimension = DEFAULT_UPLOAD_IMAGE_MAX_DIMENSION,
) {
  const safeWidth = positiveInteger(width, 0);
  const safeHeight = positiveInteger(height, 0);
  const safeMaxDimension = positiveInteger(maxDimension, DEFAULT_UPLOAD_IMAGE_MAX_DIMENSION);
  if (!safeWidth || !safeHeight) {
    throw new Error("The selected image has invalid dimensions.");
  }

  const scale = Math.min(1, safeMaxDimension / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function webpFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "").trim() || "upload-image";
  return `${baseName}.webp`;
}

async function decodeWithImageElement(file: File): Promise<DecodedUploadImage> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  try {
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

const browserUploadImageProcessor: UploadImageProcessor = {
  async decode(file) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    }
    return decodeWithImageElement(file);
  },
  async encodeWebp(source, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Image preparation is unavailable in this browser.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not encode the selected image as WebP."));
      }, "image/webp", quality);
    });
  },
};

export async function normalizeUploadImage(
  file: File,
  options: UploadImageNormalizationOptions = {},
  processor: UploadImageProcessor = browserUploadImageProcessor,
) {
  const maxDimension = positiveInteger(
    options.maxDimension ?? DEFAULT_UPLOAD_IMAGE_MAX_DIMENSION,
    DEFAULT_UPLOAD_IMAGE_MAX_DIMENSION,
  );
  const targetBytes = positiveInteger(
    options.targetBytes ?? DEFAULT_UPLOAD_IMAGE_TARGET_BYTES,
    DEFAULT_UPLOAD_IMAGE_TARGET_BYTES,
  );
  const qualities = options.qualities?.length ? options.qualities : DEFAULT_WEBP_QUALITIES;
  const decoded = await processor.decode(file);

  try {
    const dimensions = scaledUploadImageDimensions(decoded.width, decoded.height, maxDimension);
    const needsResize = dimensions.width !== decoded.width || dimensions.height !== decoded.height;
    if (!needsResize && file.size <= targetBytes) return file;

    let smallestBlob: Blob | null = null;
    for (const quality of qualities) {
      const normalizedQuality = Math.max(0.1, Math.min(1, quality));
      const blob = await processor.encodeWebp(
        decoded.source,
        dimensions.width,
        dimensions.height,
        normalizedQuality,
      );
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;
      if (blob.size <= targetBytes) break;
    }

    if (!smallestBlob) throw new Error("The selected image could not be prepared for upload.");
    if (!needsResize && smallestBlob.size >= file.size) return file;

    return new File([smallestBlob], webpFileName(file.name), {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    decoded.close();
  }
}
