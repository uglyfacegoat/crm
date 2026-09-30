"use client";

import { useSyncExternalStore } from "react";

const storageKey = "crm.navigation.v1";
const changeEvent = "crm-navigation-change";
let sessionSnapshot = "{}";
let storageAvailable = true;

function readSnapshot() {
  if (!storageAvailable) return sessionSnapshot;
  try {
    return window.localStorage.getItem(storageKey) ?? "{}";
  } catch {
    // Menu preferences can still work for this session when storage is blocked.
    storageAvailable = false;
    return sessionSnapshot;
  }
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function parsePreferences(snapshot: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
    }
  } catch {
    // A corrupt browser preference resets the menu, never application data.
  }
  return {};
}

function serverSnapshot() {
  return "{}";
}

export function useNavigationState() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const preferences = parsePreferences(snapshot);

  function setPreference(key: string, value: boolean) {
    sessionSnapshot = JSON.stringify({ ...parsePreferences(readSnapshot()), [key]: value });
    try {
      window.localStorage.setItem(storageKey, sessionSnapshot);
    } catch {
      storageAvailable = false;
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  return { preferences, setPreference };
}
