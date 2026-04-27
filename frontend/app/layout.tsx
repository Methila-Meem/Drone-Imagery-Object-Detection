import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drone Imagery Segmentation",
  description: "Semantic segmentation platform for drone imagery"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

