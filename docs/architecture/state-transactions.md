# State transactions

A node reads an immutable snapshot and returns a patch against its revision. The
runtime rejects stale revisions, undeclared paths, type mismatches, and writes not
listed by the node. A successful reduction increments the revision once and adds
execution, node, and event provenance. Effects must complete through a host tool
before their result is committed; failures do not partially mutate state.
