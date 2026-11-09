# ECWAM archive scheduling

Aer retains month-sized cache objects, while allowing several provider requests to be in flight together. `AER_ARCHIVE_CONCURRENCY` defaults to 3 and accepts 1–20. This bounds outstanding requests, rather than promising that ECMWF processes that many at once.

ECMWF's current linked limits page lists 20 queued requests per user and one active request per user, with the active allowance varying with system load. Older troubleshooting page revisions list three active requests; use the newer limits page and observed provider statuses. [ECMWF request limits](https://confluence.ecmwf.int/spaces/UDOC/pages/143040597/Total+number+of+requests+a+user+can+submit+-+Web+API+FAQ).

The scheduler holds a single SQLite coordinator lease across deployments. Within that lease it advances multiple distinct jobs concurrently. Submitted requests keep their slots between polls; repeated ticks cannot start the same job twice. Saved provider receipts survive restart. Ambiguous submissions are never retried automatically. Cached data and existing queued jobs are retained.

When filling slots, prefer locations with fewer outstanding requests, then those least recently served. Use FIFO order within a location. This prevents one location's 49 months from excluding all other locations until it finishes, including when more locations are waiting than there are slots. No requests are cancelled to make room; a newly added location uses the next available slot.

ECMWF accepts individual days and date ranges. A whole month is Aer's current extraction/cache choice, not an API requirement. Splitting into daily requests would still share the account's active-request allowance, and may repeat archive reads and queue overhead. It would also require durable partial-month storage and chart availability tracking. Smaller chunks need a measured trial before changing the extraction strategy. Grouping nearby locations by month is another candidate for reducing repeated archive work. [ECMWF retrieval efficiency](https://confluence.ecmwf.int/spaces/WEBAPI/pages/54301008/Retrieval+efficiency).

The UI distinguishes requests submitted to ECMWF from months still waiting in Aer. Submitted jobs can themselves be queued by ECMWF. Do not label every submitted request as actively processing or promise a threefold speed increase.
