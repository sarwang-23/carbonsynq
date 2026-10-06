import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ReportingPeriodProvider } from "@/context/ReportingPeriodContext";
import { Toaster } from "sonner";
import WorkspaceGate from "@/components/WorkspaceGate";

export const metadata: Metadata = {
  title: "CarbonSynq | University Carbon Workspace",
  description: "University emissions, activity review, reporting and reduction planning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ReportingPeriodProvider>
            <WorkspaceGate>{children}</WorkspaceGate>
          </ReportingPeriodProvider>
        </AuthProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
