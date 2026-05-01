import React, { useState, useEffect } from 'react';
import {
  hubspot,
  Flex,
  Box,
  Text,
  Link,
  Divider,
  LoadingSpinner,
  Alert,
} from '@hubspot/ui-extensions';

const API_BASE = 'https://mycase-hubspot.fly.dev';

const MyCaseContactCard = ({ context }) => {
  const [client, setClient] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  const portalId = context.portal.id;
  const contactId = String(context.crm.objectId);
  const props = context.crm.objectProperties ?? {};
  const myCaseId = props.my_case_id || '';

  useEffect(() => {
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
        } else {
          setMessage(data.cardLabel || 'No linked MyCase client');
        }
      })
      .catch(() => setMessage('Could not reach MyCase sync service'))
      .finally(() => setLoading(false));
  }, [portalId, contactId, myCaseId]);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading MyCase data…" showLabel />
      </Flex>
    );
  }

  if (message || !client) {
    return <Alert title="MyCase" variant="info">{message}</Alert>;
  }

  const fields = client.properties ?? [];

  return (
    <Flex direction="column" gap="small">
      <Link href={client.link} target="_blank">
        <Text format={{ fontWeight: 'bold' }}>{client.title}</Text>
      </Link>
      <Divider />
      {fields.map((field) => (
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
    </Flex>
  );
};

hubspot.extend(({ context, actions }) => (
  <MyCaseContactCard context={context} actions={actions} />
));
