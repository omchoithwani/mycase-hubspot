export default function InstallPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">Connect Your Accounts</h1>
      <p className="text-muted-foreground mb-8">
        Follow the steps below to connect HubSpot and MyCase.
      </p>

      <ol className="space-y-6">
        <Step
          number={1}
          title="Connect HubSpot"
          description="Authorize access to your HubSpot portal."
          actionHref={`${apiUrl}/auth/hubspot/install`}
          actionLabel="Connect HubSpot"
        />
        <Step
          number={2}
          title="Connect MyCase"
          description="Authorize access to your MyCase account. You will be redirected here after connecting HubSpot."
          actionHref={undefined}
          actionLabel="Connect MyCase (after HubSpot)"
        />
        <Step
          number={3}
          title="Configure Field Mapping"
          description="Map the fields you want to sync between the two systems."
          actionHref="/settings/field-mapping"
          actionLabel="Go to Field Mapping"
        />
        <Step
          number={4}
          title="Review Stage Mapping"
          description="Map HubSpot deal stages to MyCase matter statuses."
          actionHref="/settings/stage-mapping"
          actionLabel="Go to Stage Mapping"
        />
      </ol>
    </main>
  );
}

function Step({
  number,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  number: number;
  title: string;
  description: string;
  actionHref: string | undefined;
  actionLabel: string;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
        {number}
      </div>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
        {actionHref ? (
          <a
            href={actionHref}
            className="inline-block text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {actionLabel}
          </a>
        ) : (
          <span className="inline-block text-sm px-4 py-1.5 rounded-md bg-muted text-muted-foreground cursor-not-allowed">
            {actionLabel}
          </span>
        )}
      </div>
    </li>
  );
}
