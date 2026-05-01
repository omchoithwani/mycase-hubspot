import React, { useState, useEffect } from 'react';
import {
  hubspot,
  Flex,
  Text,
  Link,
  Divider,
  LoadingSpinner,
  Alert,
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

  const portalId = context.portal.id;
  const dealId = String(context.crm.objectId);
  const props = context.crm.objectProperties ?? {};
  const myCaseId = props.my_case_id || '';

  useEffect(() => {
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
        } else {
          setMessage(data.cardLabel || 'No linked MyCase case');
        }
      })
      .catch(() => setMessage('Could not reach MyCase sync service'))
      .finally(() => setLoading(false));
  }, [portalId, dealId, myCaseId]);

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading MyCase data…" showLabel />
      </Flex>
    );
  }

  if (message || !matter) {
    return <Alert title="MyCase" variant="info">{message}</Alert>;
  }

  const fields = (matter.properties ?? []).filter((f) => f.dataType !== 'STATUS');
  const statusField = (matter.properties ?? []).find((f) => f.dataType === 'STATUS');

  return (
    <Flex direction="column" gap="small">
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
    </Flex>
  );
};

hubspot.extend(({ context, actions }) => (
  <MyCaseDealCard context={context} actions={actions} />
));
