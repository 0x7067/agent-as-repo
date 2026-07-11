export interface WebhookPayload {
  eventId: string;
  url: string;
  body: Record<string, unknown>;
}

const MAX_ATTEMPTS = 3;

/**
 * Deliver a refund webhook to a merchant endpoint, retrying a few times on a
 * non-2xx response. Near-duplicate of dispatchPaymentWebhook in
 * webhook-handler.ts, kept separate to test ranking discrimination between two
 * similar bodies. Sole definition site of dispatchRefundWebhook.
 */
export async function dispatchRefundWebhook(payload: WebhookPayload): Promise<number> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(payload.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-event-kind": "refund" },
      body: JSON.stringify({ ...payload.body, eventId: payload.eventId }),
    });
    lastStatus = response.status;
    if (response.ok) {
      return lastStatus;
    }
  }
  throw new Error(`refund webhook failed with status ${String(lastStatus)}`);
}
