import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import { AuthProvider } from "./components/AuthProvider";

export const metadata: Metadata = {
  title: "Snatch - Auction Platform",
  description: "A modern auction platform supporting descending and ascending auctions with sealed and live bidding phases.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-gray-900 text-gray-100 min-h-full flex flex-col">
        <AuthProvider>
          <Header />
          <main className="flex-1">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
