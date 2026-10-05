import { createLeafletContext, LeafletProvider, type LeafletContextInterface } from "@react-leaflet/core";
import {
  Map as LeafletMap,
  type FitBoundsOptions,
  type LatLngBoundsExpression,
  type MapOptions,
} from "leaflet";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface StrictModeSafeMapContainerProps extends MapOptions {
  bounds?: LatLngBoundsExpression;
  boundsOptions?: FitBoundsOptions;
  children?: ReactNode;
  className?: string;
  id?: string;
  placeholder?: ReactNode;
  style?: CSSProperties;
  whenReady?: () => void;
}

const mapsByContainer = new WeakMap<HTMLDivElement, LeafletMap>();

/**
 * React Leaflet 4 closes over its initial null context in the container ref.
 * React's development StrictMode can reattach that ref before cleanup, which
 * attempts to initialize Leaflet twice on the same element. Keep an explicit
 * map ref and clean up any interrupted mount before creating the next map.
 */
const StrictModeSafeMapContainer = forwardRef<LeafletMap, StrictModeSafeMapContainerProps>(
  function StrictModeSafeMapContainer(
    {
      bounds,
      boundsOptions,
      center,
      children,
      className,
      id,
      placeholder,
      style,
      whenReady,
      zoom,
      ...options
    },
    forwardedRef,
  ) {
    const [containerProps] = useState({ className, id, style });
    const [context, setContext] = useState<LeafletContextInterface | null>(null);
    const mapInstanceRef = useRef<LeafletMap | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const lifecycleGenerationRef = useRef(0);

    useImperativeHandle(forwardedRef, () => context?.map ?? null, [context]);

    const attachMap = useCallback((node: HTMLDivElement | null) => {
      if (!node || mapInstanceRef.current) return;

      containerRef.current = node;
      const interruptedMap = mapsByContainer.get(node);
      if (interruptedMap) {
        interruptedMap.remove();
        mapsByContainer.delete(node);
      }

      const map = new LeafletMap(node, options);
      mapInstanceRef.current = map;
      mapsByContainer.set(node, map);

      if (center != null && zoom != null) {
        map.setView(center, zoom);
      } else if (bounds != null) {
        map.fitBounds(bounds, boundsOptions);
      }
      if (whenReady) map.whenReady(whenReady);
      setContext(createLeafletContext(map));
      // Map options are intentionally immutable after the first attachment,
      // matching React Leaflet's MapContainer contract.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const lifecycleGeneration = ++lifecycleGenerationRef.current;
      return () => {
        queueMicrotask(() => {
          // The current generation intentionally cancels React StrictMode's replay cleanup.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          if (lifecycleGenerationRef.current !== lifecycleGeneration) return;

          const map = mapInstanceRef.current;
          const container = containerRef.current;
          if (map && (!container || mapsByContainer.get(container) === map)) {
            map.remove();
          }
          if (container && mapsByContainer.get(container) === map) {
            mapsByContainer.delete(container);
          }
          mapInstanceRef.current = null;
        });
      };
    }, []);

    return (
      <div {...containerProps} ref={attachMap}>
        {context ? <LeafletProvider value={context}>{children}</LeafletProvider> : placeholder ?? null}
      </div>
    );
  },
);

export default StrictModeSafeMapContainer;
