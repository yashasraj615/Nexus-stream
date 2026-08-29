import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "../lib/nav";
import { NavGlyph } from "./NavGlyph";

function itemIsActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (to === "/directory") {
    return (
      pathname.startsWith("/directory") ||
      pathname.startsWith("/series") ||
      pathname.startsWith("/collection")
    );
  }
  return pathname.startsWith(to);
}

function NavButtons() {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    function place() {
      const root = navRef.current;
      if (!root) return;
      const active = root.querySelector(".nav-btn.active") as HTMLElement | null;
      if (!active) return;
      setPill({ x: active.offsetLeft, width: active.offsetWidth, ready: true });
    }

    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [location.pathname]);

  return (
    <nav ref={navRef}>
      <span
        className={`nav-pill${pill.ready ? " is-on" : ""}`}
        style={{ transform: `translateX(${pill.x}px)`, width: pill.width }}
        aria-hidden
      />
      {NAV_ITEMS.map((item) => {
        const active = itemIsActive(location.pathname, item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={() => `nav-btn${active ? " active" : ""}`}
            onClick={(event) => {
              if (active) event.preventDefault();
            }}
          >
            <NavGlyph name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  return (
    <div className="bottom-nav-slot">
      <div className="bottom-nav">
        <NavButtons />
      </div>
    </div>
  );
}

export function BrandLockup() {
  const navigate = useNavigate();
  return (
    <button className="top-brand" type="button" onClick={() => navigate("/")}>
      <img src="/icon-192.png" alt="" />
      <strong>Nexus Stream</strong>
    </button>
  );
}
