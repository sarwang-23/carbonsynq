"use client";
import { usePathname } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/" || path.startsWith("/auth/")) return <>{children}</>;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
