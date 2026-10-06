"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_MODE, resetDemo } from "@/lib/demo-store";
import { useAuth } from "@/context/AuthContext";
import { useDemoWorkspace } from "@/hooks/useDemoWorkspace";

export default function DemoBanner() {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const { dataMode, onboardingCompleted } = useDemoWorkspace();
  if (!DEMO_MODE) return null;
  return (
    <div data-testid="demo-banner" className="relative z-40 flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
      <p><strong className="mr-2 uppercase tracking-wide">{dataMode === "SAMPLE" ? "Demo preview" : "Your activity data"}</strong>{dataMode === "SAMPLE" ? "Sample data until your first saved entry or import" : "Your entries sit above the sample demo data · Manual/Excel estimates use demo factors"} · Invoices use your backend · Saved in this browser</p>
      <div className="flex items-center gap-4 font-semibold">
        {isAuthenticated ? <>
          {onboardingCompleted && pathname !== "/dashboard" && <Link className="hover:underline" href="/dashboard">Dashboard</Link>}
          {onboardingCompleted && pathname !== "/activity-data" && <Link className="hover:underline" href="/activity-data">Activity Data</Link>}
          <Link className="hover:underline" href="/onboarding">University setup</Link>
          <button type="button" className="hover:underline" onClick={() => {
            if (window.confirm("Reset your university setup and saved activities, and restore sample data?")) { resetDemo(); window.location.assign("/onboarding"); }
          }}>Reset demo</button>
        </> : <Link className="hover:underline" href="/auth/signin">Open demo</Link>}
      </div>
    </div>
  );
}
