import type { ReactNode } from "react";
import { RailScroll } from "./RailScroll";

export function MediaRail({ title, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  if (!items.filter(Boolean).length) return null;
  return (
    <div className="rail-block">
      <div className="row-title">
        <h3>{title}</h3>
      </div>
      <RailScroll>{children}</RailScroll>
    </div>
  );
}
