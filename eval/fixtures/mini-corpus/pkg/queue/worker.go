package queue

// Config is loaded from app.yaml; queue_batch_size caps how many jobs a single
// DrainQueue pass will pull.
type Config struct {
	QueueBatchSize int `yaml:"queue_batch_size"`
}

// Job is one unit of deferred work.
type Job struct {
	ID      string
	Payload []byte
}

// DrainQueue removes up to queue_batch_size jobs from the head of the pending
// slice and returns them for processing. Sole definition site of DrainQueue.
func DrainQueue(pending []Job, cfg Config) ([]Job, []Job) {
	limit := cfg.QueueBatchSize
	if limit <= 0 || limit > len(pending) {
		limit = len(pending)
	}
	return pending[:limit], pending[limit:]
}
