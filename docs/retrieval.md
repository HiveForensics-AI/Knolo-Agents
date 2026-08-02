# Retrieval

Native retrieval returns `RetrievalResultV1`: ranked evidence content plus an
integer score and provenance (`source_id`, locator, and content hash). Retrieval
is a policy-gated host capability, not hidden prompt augmentation. Persist the
result or event reference so replay can use recorded evidence without repeating
external reads.
