import { DISCLAIMER } from "@/lib/disclaimer";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col px-4">
      <main className="flex-1">{children}</main>
      <footer className="py-4 text-center text-xs text-muted-foreground">{DISCLAIMER}</footer>
    </div>
  );
}
