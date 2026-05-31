import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מחולל רשימת תכניות",
  description: "הפקת רשימת תכניות אחידה מקבצי PDF / ZIP של המתכנן",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen text-slate-900 antialiased">{children}</body>
    </html>
  );
}
