import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "Tradient | Paper Trading Terminal",
  description: "Alpaca paper trading operations terminal",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
