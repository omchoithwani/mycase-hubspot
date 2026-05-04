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
} from '@hubspot/ui-extensions';

const API_BASE = 'https://mycase-hubspot.fly.dev';

const MyCaseContactCard = ({ context }) => {
  const [client, setClient] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);

  const portalId = context.portal.id;
  const contactId = String(context.crm.objectId);
  const props = context.crm.objectProperties ?? {};
  const myCaseId = props.my_case_id || '';

  const fetchCard = () => {
    setLoading(true);
    const params = new URLSearchParams({
      portalId,
      associatedObjectId: contactId,
      ...(myCaseId ? { my_case_id: myCaseId } : {}),
    });
    hubspot
      .fetch(`${API_BASE}/crm-cards/contact?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.results?.length > 0) {
          setClient(data.results[0]);
          setMessage(null);
        } else {
          setMessage(data.cardLabel || 'No linked MyCase client');
        }
      })
      .catch(() => setMessage('Could not reach MyCase sync service'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCard(); }, [portalId, contactId, myCaseId]);

  const triggerSync = (force) => {
    setSyncing(true);
    setSyncMessage(null);
    const params = new URLSearchParams({
      portalId: String(portalId),
      objectId: contactId,
      objectType: 'contact',
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

  return (
    <Flex direction="column" gap="small">
      {syncMessage && <Alert title="Sync" variant="info">{syncMessage}</Alert>}

      {message || !client ? (
        <Alert title="MyCase" variant="info">{message}</Alert>
      ) : (
        <>
          <Link href={client.link} target="_blank">
            <Text format={{ fontWeight: 'bold' }}>{client.title}</Text>
          </Link>
          <Divider />
          {(client.properties ?? []).map((field) => (
            <Flex key={field.label} justify="between" align="center">
              <Text format={{ color: 'medium' }}>{field.label}</Text>
              {field.dataType === 'EMAIL' ? (
                <Link href={`mailto:${field.value}`}>{field.value}</Link>
              ) : (
                <Text>{field.value}</Text>
              )}
            </Flex>
          ))}
          <Divider />
          <Link href={client.link} target="_blank">
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
  <MyCaseContactCard context={context} actions={actions} />
));
