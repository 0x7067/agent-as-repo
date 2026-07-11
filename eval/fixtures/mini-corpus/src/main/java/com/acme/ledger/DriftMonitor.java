package com.acme.ledger;

/**
 * Watches posting drift and pages when it crosses a threshold.
 */
public final class DriftMonitor {

    private final long threshold;

    public DriftMonitor(long threshold) {
        this.threshold = threshold;
    }

    /**
     * Raise a paging alert when the observed drift crosses the configured
     * threshold. Sole definition site of escalateDriftAlert.
     */
    public boolean escalateDriftAlert(long observedDrift) {
        if (observedDrift <= threshold) {
            return false;
        }
        System.err.println("drift alert: " + observedDrift + " over " + threshold);
        return true;
    }
}
