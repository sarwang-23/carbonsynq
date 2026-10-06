"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { DEMO_MODE } from "@/lib/demo-store";
import { useDemoWorkspace } from "@/hooks/useDemoWorkspace";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { onboardingCompleted } = useDemoWorkspace();
  const needsOnboarding = DEMO_MODE && !onboardingCompleted && !["/onboarding", "/university-intake"].includes(pathname);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/auth/signin");
    } else if (!loading && isAuthenticated && needsOnboarding) {
      router.replace("/onboarding");
    }
  }, [isAuthenticated, loading, needsOnboarding, router]);

  if (loading || !isAuthenticated || needsOnboarding) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#fafafa]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-black/10 border-t-[#16a34a]" />
      </div>
    );
  }

  return <>{children}</>;
}
