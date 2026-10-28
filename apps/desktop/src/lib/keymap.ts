export type Context = "browser" | "loupe" | "crop";

export const GROUPS = [
  "Culling",
  "Browser",
  "Loupe",
  "Crop",
  "Everywhere",
] as const;

export type ActionDef = {
  label: string;
  group: (typeof GROUPS)[number];
  contexts: readonly Context[];
  keys: readonly string[];
  repeat?: boolean;
  /// macOS owns it, so it is listed but not rebindable.
  fixed?: boolean;
};

const PHOTOS = ["browser", "loupe"] as const;
const ANYWHERE = ["browser", "loupe", "crop"] as const;

const DEFINITIONS = {
  "rate.0": {
    label: "No rating",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["0"],
  },
  "rate.1": {
    label: "1 star",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["1"],
  },
  "rate.2": {
    label: "2 stars",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["2"],
  },
  "rate.3": {
    label: "3 stars",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["3"],
  },
  "rate.4": {
    label: "4 stars",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["4"],
  },
  "rate.5": {
    label: "5 stars",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["5"],
  },
  "flag.pick": {
    label: "Pick",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["p"],
  },
  "flag.reject": {
    label: "Reject",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["x"],
  },
  "flag.clear": {
    label: "Unflag",
    group: "Culling",
    contexts: PHOTOS,
    keys: ["u"],
  },
  "stack.rejectRest": {
    label: "Reject the undecided frames",
    group: "Culling",
    contexts: ["loupe"],
    keys: ["shift+x"],
  },
  "autoAdvance.toggle": {
    label: "Auto-advance",
    group: "Culling",
    contexts: ["loupe"],
    keys: ["a"],
  },
  "select.all": {
    label: "Select all",
    group: "Browser",
    contexts: ["browser"],
    keys: ["meta+a"],
  },
  "select.clear": {
    label: "Clear selection",
    group: "Browser",
    contexts: ["browser"],
    keys: ["escape"],
  },
  "loupe.close": {
    label: "Back to grid",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["escape"],
  },
  "photo.previous": {
    label: "Previous photo",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["arrowleft"],
    repeat: true,
  },
  "photo.next": {
    label: "Next photo",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["arrowright"],
    repeat: true,
  },
  "stack.enter": {
    label: "Go into the stack",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["enter"],
  },
  "stacks.toggle": {
    label: "Stacks",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["s"],
  },
  "editPanel.toggle": {
    label: "Edit panel",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["e"],
  },
  "split.toggle": {
    label: "Compare before and after",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["y"],
  },
  "exposure.up": {
    label: "Exposure +¼ EV",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["arrowup"],
    repeat: true,
  },
  "exposure.down": {
    label: "Exposure −¼ EV",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["arrowdown"],
    repeat: true,
  },
  "exposure.reset": {
    label: "Reset exposure",
    group: "Loupe",
    contexts: ["loupe"],
    keys: ["r"],
  },
  "crop.apply": {
    label: "Apply crop",
    group: "Crop",
    contexts: ["crop"],
    keys: ["enter"],
  },
  "crop.cancel": {
    label: "Cancel crop",
    group: "Crop",
    contexts: ["crop"],
    keys: ["escape"],
  },
  "crop.left": {
    label: "Nudge crop left",
    group: "Crop",
    contexts: ["crop"],
    keys: ["arrowleft", "shift+arrowleft"],
    repeat: true,
  },
  "crop.right": {
    label: "Nudge crop right",
    group: "Crop",
    contexts: ["crop"],
    keys: ["arrowright", "shift+arrowright"],
    repeat: true,
  },
  "crop.up": {
    label: "Nudge crop up",
    group: "Crop",
    contexts: ["crop"],
    keys: ["arrowup", "shift+arrowup"],
    repeat: true,
  },
  "crop.down": {
    label: "Nudge crop down",
    group: "Crop",
    contexts: ["crop"],
    keys: ["arrowdown", "shift+arrowdown"],
    repeat: true,
  },
  "history.undo": {
    label: "Undo",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["meta+z"],
    repeat: true,
  },
  "history.redo": {
    label: "Redo",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["shift+meta+z"],
    repeat: true,
  },
  "history.show": {
    label: "Show history",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["meta+y"],
  },
  "settings.copy": {
    label: "Copy settings",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["meta+c", "shift+meta+c"],
  },
  "settings.paste": {
    label: "Paste settings",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["meta+v", "shift+meta+v"],
  },
  "export.open": {
    label: "Export",
    group: "Everywhere",
    contexts: PHOTOS,
    keys: ["meta+e"],
  },
  "sidebar.toggle": {
    label: "Sidebar",
    group: "Everywhere",
    contexts: ANYWHERE,
    keys: ["meta+b"],
  },
  "app.shortcuts": {
    label: "Keyboard shortcuts",
    group: "Everywhere",
    contexts: ANYWHERE,
    keys: ["meta+/"],
  },
  "app.settings": {
    label: "Settings",
    group: "Everywhere",
    contexts: ANYWHERE,
    keys: ["meta+,"],
    fixed: true,
  },
} satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof DEFINITIONS;

export const ACTIONS: Record<ActionId, ActionDef> = DEFINITIONS;

export const isActionId = (id: string): id is ActionId =>
  Object.hasOwn(DEFINITIONS, id);

export const ACTION_IDS = Object.keys(DEFINITIONS).filter(isActionId);

export const RATING_ACTIONS = [
  "rate.0",
  "rate.1",
  "rate.2",
  "rate.3",
  "rate.4",
  "rate.5",
] as const satisfies readonly ActionId[];

export const RESERVED = new Set([
  "meta+q",
  "meta+w",
  "meta+h",
  "alt+meta+h",
  "meta+m",
  "meta+,",
  "ctrl+meta+f",
  "meta+tab",
  "meta+`",
]);

const MODIFIERS = ["ctrl", "alt", "shift", "meta"] as const;

const NAMED: Partial<Record<string, string>> = {
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  " ": "space",
  Backspace: "backspace",
  Delete: "delete",
};

type KeyFields = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const joinChord = (event: KeyFields, key: string, typed: boolean) => {
  const held = {
    ctrl: event.ctrlKey,
    // ⇧ and ⌥ are how a German Mac types \ or /, not part of the shortcut
    alt: event.altKey && !typed,
    shift: event.shiftKey && !typed,
    meta: event.metaKey,
  };
  return [...MODIFIERS.filter((modifier) => held[modifier]), key].join("+");
};

/// Digits by position first (⇧1 is not "!"), then the typed character (⌘⇧7 is ⌘/ on a German Mac).
export function chordsOf(event: KeyFields): string[] {
  const chords: string[] = [];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
  if (digit !== undefined) chords.push(joinChord(event, digit, false));
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const named = NAMED[event.key];
  if (named !== undefined) chords.push(joinChord(event, named, false));
  // ⌥ turns X into ≈ and O into ø, so its letter only survives as a position
  else if (event.altKey && letter !== undefined) {
    chords.push(joinChord(event, letter.toLowerCase(), false));
  }
  // by character, so Z stays Z on a QWERTZ keyboard and ü keeps its ⇧
  else if (/^\p{L}$/u.test(event.key)) {
    chords.push(joinChord(event, event.key.toLowerCase(), false));
  } else if ([...event.key].length === 1) {
    chords.push(joinChord(event, event.key, true));
  }
  return [...new Set(chords)];
}

/// "+" can be the key itself ("meta++").
function parseChord(chord: string) {
  const modifiers: string[] = [];
  let rest = chord;
  for (const modifier of MODIFIERS) {
    if (rest.startsWith(`${modifier}+`) && rest.length > modifier.length + 1) {
      modifiers.push(modifier);
      rest = rest.slice(modifier.length + 1);
    }
  }
  return { modifiers, key: rest };
}

export function isChord(value: string): boolean {
  const { key } = parseChord(value);
  return (
    key.length > 0 &&
    !MODIFIERS.some((modifier) => key.startsWith(`${modifier}+`))
  );
}

const SYMBOLS = new Map([
  ["ctrl", "⌃"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["meta", "⌘"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  ["arrowup", "↑"],
  ["arrowdown", "↓"],
  ["enter", "↩"],
  ["escape", "esc"],
  ["tab", "⇥"],
  ["space", "Space"],
  ["backspace", "⌫"],
  ["delete", "⌦"],
]);

// "ß".toUpperCase() is "SS"
const capital = (key: string) =>
  key.toUpperCase().length === key.length ? key.toUpperCase() : key;

export function formatChord(chord: string): string {
  const { modifiers, key } = parseChord(chord);
  return [...modifiers, key]
    .map((part) => SYMBOLS.get(part) ?? capital(part))
    .join("");
}
