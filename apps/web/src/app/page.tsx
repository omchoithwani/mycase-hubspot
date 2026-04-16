import Link from 'next/link';

export default function DashboardPage() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">MyCase ↔ HubSpot Sync</h1>
      <p className="text-muted-foreground mb-8">
        Bidirectional sync between HubSpot CRM and MyCase practice management.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <NavCard
          href="/install"
          title="Install & Connect"
          description="Connect your HubSpot portal and MyCase account"
        />
        <NavCard
          href="/settings/field-mapping"
          title="Field Mapping"
          description="Map fields between HubSpot and MyCase"
        />
        <NavCard
          href="/settings/stage-mapping"
          title="Stage Mapping"
          description="Map deal stages to matter statuses"
        />
        <NavCard
          href="/settings/sync-criteria"
          title="Sync Criteria"
          description="Define rules for which records sync"
        />
        <NavCard
          href="/sync-history"
          title="Sync History"
          description="View the audit trail of all sync activity"
        />
        <NavCard
          href="/errors"
          title="Error Log"
          description="Review and resolve sync errors"
        />
      </div>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block p-6 rounded-lg border border-border hover:border-primary transition-colors"
    >
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
