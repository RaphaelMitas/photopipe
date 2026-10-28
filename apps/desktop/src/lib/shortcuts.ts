import { useEffect, useRef } from "react";
import {
  ACTION_IDS,
  ACTIONS,
  type ActionId,
  type Context,
  chordsOf,
  formatChord,
  isActionId,
  isChord,
  RATING_ACTIONS,
  RESERVED,
} from "@/lib/keymap";
import { isModalOpen } from "@/lib/modal";
import { pref } from "@/lib/pref";

type Overrides = Partial<Record<ActionId, readonly string[]>>;

function decodeOverrides(raw: string | null): Overrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const overrides: Overrides = {};
  for (const [id, keys] of Object.entries(parsed)) {
    if (!isActionId(id) || ACTIONS[id].fixed || !Array.isArray(keys)) continue;
    const list: unknown[] = keys;
    const chords = list.filter(
      (key): key is string =>
        typeof key === "string" && isChord(key) && !RESERVED.has(key),
    );
    if (chords.length === list.length) overrides[id] = [...new Set(chords)];
  }
  return overrides;
}

const overridesPref = pref<Overrides>(
  "photopipe.shortcuts",
  decodeOverrides,
  JSON.stringify,
);

export const bindingsOf = (
  id: ActionId,
  overrides: Overrides = overridesPref.get(),
): readonly string[] => overrides[id] ?? ACTIONS[id].keys;

export const isChanged = (id: ActionId, overrides: Overrides) =>
  overrides[id] !== undefined;

export const useOverrides = overridesPref.use;

export function shortcutLabel(
  id: ActionId,
  overrides: Overrides = overridesPref.get(),
): string | null {
  const [first] = bindingsOf(id, overrides);
  return first === undefined ? null : formatChord(first);
}

export function useShortcutLabel(id: ActionId | undefined): string | null {
  const overrides = useOverrides();
  return id ? shortcutLabel(id, overrides) : null;
}

function withBindings(
  overrides: Overrides,
  id: ActionId,
  keys: readonly string[],
): Overrides {
  const unique = [...new Set(keys)];
  const defaults = ACTIONS[id].keys;
  const { [id]: _, ...rest } = overrides;
  const isDefault =
    unique.length === defaults.length &&
    unique.every((key, index) => key === defaults[index]);
  return isDefault ? rest : { ...rest, [id]: unique };
}

const overlaps = (a: ActionId, b: ActionId) =>
  ACTIONS[a].contexts.some((context) => ACTIONS[b].contexts.includes(context));

const holdersOf = (
  id: ActionId,
  press: readonly string[],
  overrides: Overrides,
) =>
  ACTION_IDS.filter(
    (other) =>
      other !== id &&
      overlaps(id, other) &&
      bindingsOf(other, overrides).some((key) => press.includes(key)),
  );

export const conflictsOf = (id: ActionId, press: readonly string[]) =>
  holdersOf(id, press, overridesPref.get());

/// Whoever held the key gets `replacing` back if it is still free, so a swap loses nothing.
function evict(
  overrides: Overrides,
  id: ActionId,
  press: readonly string[],
  replacing: string | null,
): Overrides {
  let next = overrides;
  for (const other of holdersOf(id, press, next)) {
    const kept = bindingsOf(other, next).filter((key) => !press.includes(key));
    const free =
      replacing !== null &&
      holdersOf(other, [replacing], next).every((holder) => holder === id);
    next = withBindings(next, other, free ? [...kept, replacing] : kept);
  }
  return next;
}

export function assigned(
  overrides: Overrides,
  id: ActionId,
  replacing: string | null,
  press: readonly string[],
): Overrides {
  if (replacing !== null && press.includes(replacing)) return overrides;
  const own = bindingsOf(id, overrides);
  const chord = press.find((key) => own.includes(key)) ?? press[0];
  if (chord === undefined) return overrides;
  const next = evict(overrides, id, press, replacing);
  const mine = bindingsOf(id, next);
  return withBindings(
    next,
    id,
    replacing && mine.includes(replacing)
      ? mine.map((key) => (key === replacing ? chord : key))
      : [...mine, chord],
  );
}

export const assignShortcut = (
  id: ActionId,
  replacing: string | null,
  press: readonly string[],
) => overridesPref.set(assigned(overridesPref.get(), id, replacing, press));

export function unbindShortcut(id: ActionId, chord: string) {
  const overrides = overridesPref.get();
  overridesPref.set(
    withBindings(
      overrides,
      id,
      bindingsOf(id, overrides).filter((key) => key !== chord),
    ),
  );
}

/// Whoever is left with no key falls back on its own defaults where they are free.
export function resetShortcut(id: ActionId) {
  const { keys } = ACTIONS[id];
  const overrides = overridesPref.get();
  let next = withBindings(evict(overrides, id, keys, null), id, keys);
  for (const other of holdersOf(id, keys, overrides)) {
    if (bindingsOf(other, next).length > 0) continue;
    const free = ACTIONS[other].keys.filter(
      (key) => holdersOf(other, [key], next).length === 0,
    );
    next = withBindings(next, other, free);
  }
  overridesPref.set(next);
}

export const resetAllShortcuts = () => overridesPref.set({});

/// Returning false leaves the key to whoever else wants it.
type Handler = () => unknown;
type Handlers = Partial<Record<ActionId, Handler>>;
type Registration = {
  context: Context | undefined;
  handlers: Handlers;
};

export const ratingHandlers = (rate: (rating: number) => unknown): Handlers =>
  Object.fromEntries(
    RATING_ACTIONS.map((id, rating) => [id, () => rate(rating)]),
  );

const registrations: { current: Registration }[] = [];
const claims: Context[] = [];
const SPECIFICITY: readonly Context[] = ["crop", "loupe", "browser"];

export const activeContext = (): Context =>
  SPECIFICITY.find((context) => claims.includes(context)) ?? "browser";

// A tooltip spends Escape on closing itself; pass it on unless a popover or menu is next in line.
const released = new WeakSet<Event>();
export function releaseEscape(event: KeyboardEvent) {
  if (
    !document.querySelector("[role='dialog'], [role='menu'], [role='listbox']")
  ) {
    released.add(event);
  }
}

function ignored(event: KeyboardEvent): boolean {
  if (event.defaultPrevented && !released.has(event)) return true;
  if (isModalOpen()) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea"))
  ) {
    return true;
  }
  // a focused button acts on these itself
  if (
    (event.key === "Enter" || event.key === " ") &&
    target?.closest("button, select")
  ) {
    return true;
  }
  return (
    event.key.startsWith("Arrow") &&
    target?.closest("[data-slot='slider'], select") != null
  );
}

function handlerFor(id: ActionId, context: Context): Handler | undefined {
  for (let at = registrations.length - 1; at >= 0; at--) {
    const registration = registrations[at].current;
    const handler =
      (registration.context ?? context) === context &&
      registration.handlers[id];
    if (handler) return handler;
  }
}

function dispatch(event: KeyboardEvent) {
  if (ignored(event)) return;
  const chords = chordsOf(event);
  const context = activeContext();
  const overrides = overridesPref.get();
  for (const id of ACTION_IDS) {
    const action = ACTIONS[id];
    if (!action.contexts.includes(context)) continue;
    const bindings = bindingsOf(id, overrides);
    if (!chords.some((chord) => bindings.includes(chord))) continue;
    const handler = handlerFor(id, context);
    if (!handler) continue;
    // held down, a rating would land on every photo it advances onto
    if (event.repeat && !action.repeat) {
      event.preventDefault();
      return;
    }
    if (handler() === false) continue;
    event.preventDefault();
    return;
  }
}

/// Pass `context` when the same action does something else elsewhere.
export function useShortcuts(handlers: Handlers, context?: Context) {
  const latest = useRef<Registration>({ context, handlers });
  latest.current = { context, handlers };
  useEffect(() => {
    const registration = latest;
    registrations.push(registration);
    if (registrations.length === 1)
      window.addEventListener("keydown", dispatch);
    return () => {
      registrations.splice(registrations.indexOf(registration), 1);
      if (registrations.length === 0) {
        window.removeEventListener("keydown", dispatch);
      }
    };
  }, []);
}

/// The most specific claimed context wins.
export function useShortcutContext(context: Context) {
  useEffect(() => {
    claims.push(context);
    return () => {
      claims.splice(claims.indexOf(context), 1);
    };
  }, [context]);
}
