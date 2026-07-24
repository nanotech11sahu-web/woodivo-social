/**
 * Loose shapes for Meta's webhook payloads - Page (Facebook) and Instagram
 * events both arrive on the same POST body structure ("entry[].changes[]"
 * for comments, "entry[].messaging[]" for Messenger/Instagram DMs), Meta just
 * varies which fields are populated per product. Only the fields this app
 * actually reads are typed; everything else passes through as `unknown` in
 * the raw payload stored on InboundEventLog.
 */

export interface MetaCommentChangeValue {
  from?: { id: string; name?: string };
  message?: string;
  comment_id?: string;
  post_id?: string;
  media_id?: string;
  item?: string;
  verb?: string;
}

export interface MetaWebhookChange {
  field: string;
  value: MetaCommentChangeValue;
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string };
}

export interface MetaWebhookEntry {
  id: string;
  time?: number;
  changes?: MetaWebhookChange[];
  messaging?: MetaMessagingEvent[];
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram' | string;
  entry: MetaWebhookEntry[];
}
