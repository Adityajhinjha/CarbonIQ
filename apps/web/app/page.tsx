"use client";
import dynamic from "next/dynamic";

const CarbonIQ = dynamic(() => import("../src/carboniq/CarbonIQ"), { ssr: false });

export default function Page() {
  return (
    <CarbonIQ
      apiBaseUrl={process.env.NEXT_PUBLIC_CARBONIQ_API_URL || "http://localhost:8000/api/v1"}
      mode={process.env.NEXT_PUBLIC_CARBONIQ_MODE === "demo" ? "demo" : "api"}
    />
  );
}
