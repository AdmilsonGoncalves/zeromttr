export const MOCK_GIT_DIFF = `diff --git a/apps/target-app-demo/src/repositories/payment.repository.ts b/apps/target-app-demo/src/repositories/payment.repository.ts
index e69de29..b898638 100644
--- a/apps/target-app-demo/src/repositories/payment.repository.ts
+++ b/apps/target-app-demo/src/repositories/payment.repository.ts
@@ -24,7 +24,7 @@ export class PaymentRepository {
     pool: {
       min: 2,
       max: 10,
-      acquireTimeoutMillis: 5000,
+      acquireTimeoutMillis: 100, // Regression introduced in v2.14.8
       createTimeoutMillis: 3000,
       idleTimeoutMillis: 30000
     }
`;

export const RAW_PRE_COLLECTOR_LOG =
  '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 phone 11987654321 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-z: pool connection acquire timeout after 4710ms';

export const MASKED_POST_OTTL_LOG =
  '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ] phone [REDACTED_PHONE] Bearer [REDACTED_JWT]: pool connection acquire timeout after 4710ms';
