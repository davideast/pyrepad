/**
 * Typed synchronous event emitter shared by the sync adapters and editor adapters.
 * `Events` maps each event name to its listener argument tuple.
 */
export type Listener<Args extends unknown[]> = (...args: Args) => void;

type ListenerTable<Events extends Record<string, unknown[]>> = {
  [K in keyof Events]?: Listener<Events[K]>[];
};

export class Emitter<Events extends Record<string, unknown[]>> {
  listeners: ListenerTable<Events> = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const list = this.listeners[event] || [];
    list.push(fn);
    this.listeners[event] = list;
  }

  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const wrapper: Listener<Events[K]> = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    this.on(event, wrapper);
  }

  /** Removes one listener, every listener for `event`, or (no args) every listener. */
  off<K extends keyof Events>(event?: K, fn?: Listener<Events[K]>): void {
    if (event === undefined) {
      this.listeners = {};
      return;
    }
    const list = this.listeners[event];
    if (!list) return;
    if (fn) this.listeners[event] = list.filter((cb) => cb !== fn);
    else delete this.listeners[event];
  }

  /** Listeners run over a snapshot, so on/off during a trigger affects the next one. */
  trigger<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    for (const cb of [...list]) cb(...args);
  }
}
