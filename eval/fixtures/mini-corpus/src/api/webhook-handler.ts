export interface WebhookPayload {
  eventId: string;
  url: string;
  body: Record<string, unknown>;
}

const MAX_ATTEMPTS = 3;

/**
 * Deliver a payment webhook to a merchant endpoint, retrying a few times on a
 * non-2xx response. Near-duplicate of dispatchRefundWebhook in
 * webhook-retry.ts, kept separate to test ranking discrimination between two
 * similar bodies. Sole definition site of dispatchPaymentWebhook.
 */
export async function dispatchPaymentWebhook(payload: WebhookPayload): Promise<number> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(payload.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-event-kind": "payment" },
      body: JSON.stringify({ ...payload.body, eventId: payload.eventId }),
    });
    lastStatus = response.status;
    if (response.ok) {
      return lastStatus;
    }
  }
  throw new Error(`payment webhook failed with status ${String(lastStatus)}`);
}
