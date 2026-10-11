import {useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent} from 'react';

const MIN_ZOOM = 1, MAX_ZOOM = 16;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16];
/** Keep native scrolling (including touch/keyboard), adding cursor-anchored wheel
 * zoom and mouse dragging. Moving the viewport never changes reward selection. */
export function useDistributionViewport() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [dragging, setDragging] = useState(false);
  const scale = useRef(MIN_ZOOM);
  const pendingScroll = useRef<{left:number; top:number}|null>(null);
  const gesture = useRef<{id:number; x:number; y:number; left:number; top:number; moved:boolean}|null>(null);
  const suppressClick = useRef(false);

  const zoomTo = (requested:number, anchor?:{x:number;y:number}) => {
    const element = viewportRef.current;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requested));
    if (!element || next === scale.current) return;
    const point = anchor ?? {x:element.clientWidth/2, y:element.clientHeight/2};
    const current = pendingScroll.current ?? {left:element.scrollLeft, top:element.scrollTop};
    const ratio = next/scale.current;
    pendingScroll.current = next === MIN_ZOOM ? {left:0,top:0} : {left:(current.left+point.x)*ratio-point.x, top:(current.top+point.y)*ratio-point.y};
    scale.current = next;
    setZoom(next);
  };
  useLayoutEffect(() => {
    if (viewportRef.current && pendingScroll.current) {
      viewportRef.current.scrollLeft = pendingScroll.current.left;
      viewportRef.current.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const wheel = (event:WheelEvent) => {
      // Preserve the browser's accessibility zoom and trackpad pinch gesture.
      if (event.ctrlKey || event.metaKey || !event.deltaY || gesture.current) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = Math.max(-150,Math.min(150,event.deltaY*unit));
      zoomTo(scale.current*Math.exp(-delta*.002), {x:event.clientX-rect.left-element.clientLeft,y:event.clientY-rect.top-element.clientTop});
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return () => element.removeEventListener('wheel',wheel);
  }, []);

  const onPointerDown = (event:PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    // Leave scrollbar interaction to the browser.
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX-rect.left >= event.currentTarget.clientWidth || event.clientY-rect.top >= event.currentTarget.clientHeight) return;
    gesture.current = {id:event.pointerId,x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop,moved:false};
  };
  const onPointerMove = (event:PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)<4) return;
    if (!drag.moved) {
      drag.moved=true; suppressClick.current=true; setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft=drag.left-dx;
    event.currentTarget.scrollTop=drag.top-dy;
  };
  const endDrag = (event:PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current=null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onClickCapture = (event:MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current && event.detail !== 0) {event.preventDefault();event.stopPropagation();suppressClick.current=false;}
  };
  const focusPoint = (x:number, y:number, size:number) => {
    const element = viewportRef.current;
    if (!element) return;
    const next = Math.min(MAX_ZOOM, Math.max(2, size / element.clientWidth));
    const left = x / size * element.clientWidth * next - element.clientWidth / 2;
    const top = y / size * element.clientWidth * next - element.clientHeight / 2;
    if (next === scale.current) {element.scrollLeft=left; element.scrollTop=top;}
    else {pendingScroll.current={left,top}; scale.current=next; setZoom(next);}
  };
  return {viewportRef, zoom, dragging, canZoomIn:zoom<MAX_ZOOM, canZoomOut:zoom>MIN_ZOOM, focusPoint,
    zoomIn:()=>zoomTo(ZOOM_STEPS.find(step=>step>scale.current)??MAX_ZOOM),
    zoomOut:()=>zoomTo([...ZOOM_STEPS].reverse().find(step=>step<scale.current)??MIN_ZOOM),
    fit:()=>zoomTo(MIN_ZOOM), handlers:{onPointerDown,onPointerMove,onPointerUp:endDrag,onPointerCancel:endDrag,onLostPointerCapture:endDrag,onClickCapture}};
}
