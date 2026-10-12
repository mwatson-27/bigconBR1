import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "THE BIG CON — FPS BATTLE ROYALE",
  description:
    "A multiplayer first-person battle royale set in the world of The Big Con. Seize the nodes, dodge the regulators, take the money and run.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
