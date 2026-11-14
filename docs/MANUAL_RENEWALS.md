# Manual subscription renewals

SubsManager Manga never charges a subscription merely because its billing date has arrived.

1. The Render cron scans active Shopify subscription contracts every ten minutes.
2. Due contracts are synchronized into SubsManager Manga and shown as **Due — approval needed**.
3. Staff contact the customer and obtain approval.
4. An owner or administrator opens the due subscription and selects **Charge due cycle**.
5. The server verifies that the contract is active, the cycle is actually due, and no attempt for
   that contract and billing date has already been requested.
6. SubsManager Manga asks Shopify to create the billing attempt. Shopify keeps the payment method vaulted and
   creates the renewal order only after a successful payment.

Both the embedded Shopify app and the external control center use this same guarded manual flow.
Future cycles cannot be charged early through either interface. Every external-dashboard charge is
recorded in the audit log.
