export interface HsProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface HsWebhookEvent {
  appId: number;
  eventId: number;
  subscriptionId: number;
  portalId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
  objectId: number;
  changeSource?: string;
  propertyName?: string;
  propertyValue?: string;
  changeFlag?: string;
}
