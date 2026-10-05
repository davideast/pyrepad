import React, { useEffect, useRef, useState } from "react";

export type MenuItem =
  | "separator"
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    };

export interface MenuSpec {
  label: string;
  items: () => MenuItem[];
}

/** Items are built each time a menu opens, so enabled state is always current. */
export function MenuBar(props: { menus: MenuSpec[] }): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={barRef} className="sg-menubar" role="menubar">
      {props.menus.map((menu, i) => (
        <div key={menu.label} className="sg-menu">
          <button
            type="button"
            role="menuitem"
            className={open === i ? "sg-menu-btn sg-menu-open" : "sg-menu-btn"}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i ? (
            <ul className="sg-menu-list" role="menu">
              {menu.items().map((item, n) =>
                item === "separator" ? (
                  <li key={n} className="sg-menu-sep" role="separator" />
                ) : (
                  <li key={item.label} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="sg-menu-item"
                      disabled={item.disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(null);
                        item.onSelect();
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                    </button>
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
