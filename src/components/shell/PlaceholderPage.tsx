import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section aria-labelledby="page-heading" className="space-y-4">
      <h1 id="page-heading" className="text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Coming soon</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This screen is a placeholder from the Phase 0 foundation.
        </CardContent>
      </Card>
    </section>
  );
}
