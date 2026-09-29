import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = {
  title: "CarbonIQ — A clearer future. A smarter footprint.",
  description: "Evidence-aware carbon-credit intelligence. Discover projects, compare quality, understand risk and build a diversified demonstration portfolio."
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ margin: 0, background: "#080e0b" }}>
        {children}
      </body>
    </html>
  );
}
