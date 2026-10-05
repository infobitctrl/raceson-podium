import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import type { PortalEventGalleryItem } from "@/lib/portal-data";
import { cn } from "@/lib/utils";
import { isNextOptimizablePublicImageUrl } from "@/shared/media/optimizedPublicImage";

type EventGalleryMosaicProps = {
  items: PortalEventGalleryItem[];
  mode: "preview" | "gallery";
  limit?: number;
};

function getDesktopPreviewPlacement(itemCount: number, index: number) {
  if (index === 0) return "md:col-span-7 md:row-span-2";
  if (index < 3) return "md:col-span-5";

  const remaining = itemCount - 3;
  if (remaining === 1) return "md:col-span-12";
  if (remaining === 2) return "md:col-span-6";
  if (remaining === 3) return "md:col-span-4";
  return "md:col-span-3";
}

function EventGalleryPreviewImage({
  imageUrl,
  alt,
  index,
}: {
  imageUrl: string;
  alt: string;
  index: number;
}) {
  const className = "object-cover transition duration-500 group-hover:scale-[1.035]";

  if (isNextOptimizablePublicImageUrl(imageUrl)) {
    return (
      <Image
        src={imageUrl}
        alt={alt}
        fill
        sizes={index === 0
          ? "(max-width: 767px) 100vw, 58vw"
          : "(max-width: 767px) 50vw, 42vw"}
        quality={75}
        loading="lazy"
        className={className}
      />
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      decoding="async"
      loading="lazy"
      className={`h-full w-full ${className}`}
    />
  );
}

export default function EventGalleryMosaic({
  items,
  mode,
  limit = 7,
}: EventGalleryMosaicProps) {
  const visibleItems = mode === "preview" ? items.slice(0, Math.min(Math.max(limit, 3), 7)) : items;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedItem = selectedIndex == null ? null : visibleItems[selectedIndex] ?? null;
  const isOpen = selectedIndex != null;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedIndex(null);
      } else if (event.key === "ArrowLeft") {
        setSelectedIndex((current) => (
          current == null ? null : (current - 1 + visibleItems.length) % visibleItems.length
        ));
      } else if (event.key === "ArrowRight") {
        setSelectedIndex((current) => (
          current == null ? null : (current + 1) % visibleItems.length
        ));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isOpen, visibleItems.length]);

  if (!visibleItems.length) return null;

  const openPrevious = () => {
    setSelectedIndex((current) => (
      current == null ? null : (current - 1 + visibleItems.length) % visibleItems.length
    ));
  };
  const openNext = () => {
    setSelectedIndex((current) => (
      current == null ? null : (current + 1) % visibleItems.length
    ));
  };

  return (
    <>
      {mode === "preview" ? (
        <div className="grid auto-rows-[9.5rem] grid-cols-2 gap-2.5 sm:auto-rows-[11rem] md:grid-cols-12 md:auto-rows-[10.5rem] md:gap-3">
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`Open race photo ${index + 1} of ${visibleItems.length}`}
              className={cn(
                "group relative min-h-0 overflow-hidden rounded-[20px] bg-muted text-left shadow-sm outline-none transition duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                index === 0 && visibleItems.length % 2 === 1 && "col-span-2 row-span-2",
                getDesktopPreviewPlacement(visibleItems.length, index),
              )}
            >
              <EventGalleryPreviewImage
                imageUrl={item.imageUrl}
                alt={item.caption ?? `Race photo ${index + 1}`}
                index={index}
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-60 transition group-hover:opacity-90" />
              <span className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-white/25 bg-black/35 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-white backdrop-blur-md">
                {String(index + 1).padStart(2, "0")}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 sm:gap-4 xl:columns-4">
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`Open race photo ${index + 1} of ${visibleItems.length}`}
              className="group mb-3 block w-full break-inside-avoid overflow-hidden rounded-[22px] bg-muted shadow-sm outline-none transition duration-300 hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:mb-4"
            >
              <img
                src={item.imageUrl}
                alt={item.caption ?? `Race photo ${index + 1}`}
                loading="lazy"
                className="h-auto w-full object-cover transition duration-500 group-hover:scale-[1.025]"
              />
            </button>
          ))}
        </div>
      )}

      {selectedItem && selectedIndex != null ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Race photo ${selectedIndex + 1} of ${visibleItems.length}`}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/95 p-3 backdrop-blur-sm sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedIndex(null);
          }}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setSelectedIndex(null)}
            aria-label="Close gallery viewer"
            className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>

          {visibleItems.length > 1 ? (
            <>
              <button
                type="button"
                onClick={openPrevious}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={openNext}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}

          <img
            src={selectedItem.imageUrl}
            alt={selectedItem.caption ?? `Race photo ${selectedIndex + 1}`}
            className="max-h-[88vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl"
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
            {selectedIndex + 1} / {visibleItems.length}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
