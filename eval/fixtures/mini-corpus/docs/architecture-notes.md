# Architecture Notes

The reconciliation service is split into a pure computation layer and a thin
delivery layer. Movement math never touches the network; adapters own every
side effect.

Batches flow inbound from the import feed, land in a durable queue, and are
drained by workers in fixed-size groups. Each drained group is folded into a
running balance, compared against its counterparty, and either cleared or
raised for human review.

Alerting is deliberately dumb: a single rendered string is handed to whatever
channel the operator configured, with no branching logic in the transport.
