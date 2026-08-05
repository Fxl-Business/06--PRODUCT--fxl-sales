# Production promotion: v2.4.0

- Gate: `3b`
- Decision: approved by the user
- Release commit: `a32b1a04fabbc63b5bb67ad411e23e90615e744d`
- Tag: `v2.4.0`
- Staging branch: `a32b1a04fabbc63b5bb67ad411e23e90615e744d`
- Production branch: `a32b1a04fabbc63b5bb67ad411e23e90615e744d`
- Vercel deployment: `5767404004`
- Vercel status: `success`
- Result: PASS

Before production promotion, the staging database journal contained migrations `0016`, `0017`, and `0018`.
The staging database contained the durable session table, professional split column, and professional payable identity column.
Both migration `0018` indexes were valid and its composite foreign key was validated.

The remote `production` branch fast-forwarded from `cd852bdb` to the exact `v2.4.0` commit.
The remote `staging` branch and dereferenced tag already resolved to the same commit.
The Vercel production deployment for the release commit completed successfully.
