"use client";

import { useSyncExternalStore } from "react";
import { DEMO_KEY, DEMO_STATE_EVENT } from "@/lib/demo-store";

function subscribe(listener: () => void) {
  window.addEventListener(DEMO_STATE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(DEMO_STATE_EVENT, listener); window.removeEventListener("storage", listener); };
}
function snapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
    return `${saved.onboardingCompleted === true}:${saved.dataMode === "USER" ? "USER" : "SAMPLE"}`;
  } catch { return "false:SAMPLE"; }
}
export function useDemoWorkspace() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "false:SAMPLE");
  const [completed, mode] = value.split(":");
  return { onboardingCompleted: completed === "true", dataMode: mode as "SAMPLE" | "USER" };
}
