/**
 * Runtime settings loader. The raw config file uses snake_case keys such as
 * max_drift_tolerance; this module maps them onto the camelCase shape the rest
 * of the code consumes. Sole definition site of loadRuntimeSettings.
 */

export interface RuntimeSettings {
  maxDriftTolerance: number;
  queueBatchSize: number;
}

interface RawConfig {
  max_drift_tolerance?: number;
  queue_batch_size?: number;
}

const DEFAULT_MAX_DRIFT_TOLERANCE = 100;
const DEFAULT_QUEUE_BATCH_SIZE = 32;

export function loadRuntimeSettings(raw: RawConfig = {}): RuntimeSettings {
  return {
    maxDriftTolerance: raw.max_drift_tolerance ?? DEFAULT_MAX_DRIFT_TOLERANCE,
    queueBatchSize: raw.queue_batch_size ?? DEFAULT_QUEUE_BATCH_SIZE,
  };
}
