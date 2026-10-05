import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

type UseProgressiveListOptions = {
  totalCount: number;
  resetKey: string;
  batchSize?: number;
  initialCount?: number;
  rootMargin?: string;
};

type UseProgressiveListResult = {
  visibleCount: number;
  canLoadMore: boolean;
  loadMore: () => void;
  sentinelRef: RefCallback<HTMLDivElement>;
};

export function useProgressiveList({
  totalCount,
  resetKey,
  batchSize = 20,
  initialCount = batchSize,
  rootMargin = "320px 0px",
}: UseProgressiveListOptions): UseProgressiveListResult {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(initialCount, totalCount));
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);
  const [isSentinelVisible, setIsSentinelVisible] = useState(false);
  const autoLoadLockRef = useRef(false);

  useEffect(() => {
    setVisibleCount(Math.min(initialCount, totalCount));
    autoLoadLockRef.current = false;
  }, [initialCount, resetKey, totalCount]);

  useEffect(() => {
    if (!sentinelNode) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSentinelVisible(entry.isIntersecting);
      },
      { rootMargin },
    );

    observer.observe(sentinelNode);

    return () => observer.disconnect();
  }, [rootMargin, sentinelNode]);

  const canLoadMore = visibleCount < totalCount;

  useEffect(() => {
    if (!isSentinelVisible) {
      autoLoadLockRef.current = false;
      return;
    }

    if (!canLoadMore || autoLoadLockRef.current) {
      return;
    }

    autoLoadLockRef.current = true;
    setVisibleCount((current) => Math.min(current + batchSize, totalCount));
  }, [batchSize, canLoadMore, isSentinelVisible, totalCount]);

  const loadMore = useCallback(() => {
    autoLoadLockRef.current = false;
    setVisibleCount((current) => Math.min(current + batchSize, totalCount));
  }, [batchSize, totalCount]);

  return {
    visibleCount,
    canLoadMore,
    loadMore,
    sentinelRef: setSentinelNode,
  };
}
