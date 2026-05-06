import React, { useState, useEffect } from 'react';
import {
  hubspot,
  Flex,
  Text,
  Link,
  Divider,
  LoadingSpinner,
  Alert,
  Button,
  Tag,
} from '@hubspot/ui-extensions';

const API_BASE = 'https://mycase-hubspot.fly.dev';

const STATUS_VARIANT = {
  Open: 'success',
  Closed: 'default',
};

const MyCaseDealCard = ({ context }) => {
  const [matter, setMatter] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);

  const portalId = context.portal.id;
  const dealId = String(context.crm.objectId);
  const props = context.crm.objectProperties ?? {};
  const myCaseId = props.my_case_id || '';

  const fetchCard = () => {
    setLoading(true);
    const params = new URLSearchParams({
      portalId,
      associatedObjectId: dealId,
      ...(myCaseId ? { my_case_id: myCaseId } : {}),
    });
    hubspot
      .fetch(`${API_BASE}/crm-cards/deal?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.results?.length > 0) {
          setMatter(data.results[0]);
          setMessage(null);
        } else {
          setMessage(data.cardLabel || 'No linked MyCase case');
        }
      })
      .catch(() => setMessage('Could not reach MyCase sync service'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCard(); }, [portalId, dealId, myCaseId]);

  const triggerSync = (force) => {
    setSyncing(true);
    setSyncMessage(null);
    const params = new URLSearchParams({
      portalId: String(portalId),
      objectId: dealId,
      objectType: 'deal',
      force: String(force),
    });
    hubspot
      .fetch(`${API_BASE}/crm-cards/sync?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setSyncMessage(data.queued ? 'Sync queued — refresh in a moment.' : (data.error || 'Failed to queue sync'));
        setTimeout(() => { setSyncMessage(null); fetchCard(); }, 3000);
      })
      .catch(() => setSyncMessage('Could not reach sync service'))
      .finally(() => setSyncing(false));
  };

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading MyCase data…" showLabel />
      </Flex>
    );
  }

  const fields = (matter?.properties ?? []).filter((f) => f.dataType !== 'STATUS');
  const statusField = (matter?.properties ?? []).find((f) => f.dataType === 'STATUS');
  const warnings = matter?.fieldWarnings ?? [];

  return (
    <Flex direction="column" gap="small">
      {syncMessage && <Alert title="Sync" variant="info">{syncMessage}</Alert>}

      {warnings.length > 0 && (
        <Alert title={`${warnings.length} field${warnings.length > 1 ? 's' : ''} not synced — value mismatch`} variant="warning">
          {warnings.map((w) => (
            <Text key={w.field}>
              <Text format={{ fontWeight: 'bold' }}>{w.field}</Text>{': "'}
              {String(w.droppedValue ?? '')}
              {'" — '}{w.reason}
            </Text>
          ))}
        </Alert>
      )}

      {message || !matter ? (
        <Alert title="MyCase" variant="info">{message}</Alert>
      ) : (
        <>
          <Flex justify="between" align="center">
            <Link href={matter.link} target="_blank">
              <Text format={{ fontWeight: 'bold' }}>{matter.title}</Text>
            </Link>
            {statusField && (
              <Tag variant={STATUS_VARIANT[statusField.value] ?? 'default'}>
                {statusField.value}
              </Tag>
            )}
          </Flex>
          <Divider />
          {fields.map((field) => (
            <Flex key={field.label} justify="between" align="center">
              <Text format={{ color: 'medium' }}>{field.label}</Text>
              <Text>{field.value}</Text>
            </Flex>
          ))}
          <Divider />
          <Link href={matter.link} target="_blank">
            <Text>Open in MyCase →</Text>
          </Link>
        </>
      )}

      <Divider />
      <Flex direction="row" gap="small" justify="end">
        <Button
          variant="secondary"
          size="xs"
          disabled={syncing}
          onClick={() => triggerSync(false)}
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
        <Button
          variant="destructive"
          size="xs"
          disabled={syncing}
          onClick={() => triggerSync(true)}
        >
          Force Sync
        </Button>
      </Flex>
    </Flex>
  );
};

hubspot.extend(({ context, actions }) => (
  <MyCaseDealCard context={context} actions={actions} />
));
