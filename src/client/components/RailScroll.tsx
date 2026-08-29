import { useRef, type PointerEvent, type ReactNode } from "react";

const DRAG_THRESHOLD = 8;

export function RailScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({
    pointerId: -1,
    startX: 0,
    startScroll: 0,
    moved: false,
    active: false,
  });

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      active: true,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    const state = drag.current;
    if (!el || !state.active || event.pointerId !== state.pointerId) return;
    const dx = event.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!state.moved) {
      state.moved = true;
      el.classList.add("is-dragging");
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    event.preventDefault();
    el.scrollLeft = state.startScroll - dx;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    const state = drag.current;
    if (!state.active || event.pointerId !== state.pointerId) return;
    state.active = false;
    el?.classList.remove("is-dragging");
    if (state.moved) {
      window.setTimeout(() => {
        state.moved = false;
      }, 0);
    }
  }

  return (
    <div
      ref={ref}
      className="rail-scroll"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(event) => {
        if (drag.current.moved) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
