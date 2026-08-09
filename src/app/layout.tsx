import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alyva — AI-native SREonCall",
  description: "An AI-native SRE that onboards itself and self-corrects its own alert rules.",
  icons: { icon: "/logo/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
