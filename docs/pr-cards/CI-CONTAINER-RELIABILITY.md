# CI container reliability

Owner requested diagnosing slow development and fixing actionable obstacles.
A shared PostgreSQL mirror returned toomanyrequests/Data limit exceeded in Hub CI.
Replace the identical mirror in this repository with official postgres:17, preserving
version, isolated database, healthchecks, emulation and all merge checks.
No test assertion, provider access, production grant or spending change.
Validate workflow source and exact-head CI; record final-main checks separately.
