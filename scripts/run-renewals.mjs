const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");
const jobSecret = process.env.JOB_SECRET;

if (!appUrl || !jobSecret) {
  throw new Error("SHOPIFY_APP_URL and JOB_SECRET are required for the renewal job");
}

const response = await fetch(`${appUrl}/api/jobs/renewals`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jobSecret}` },
  signal: AbortSignal.timeout(10 * 60 * 1000),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Renewal job failed (${response.status}): ${body.slice(0, 1000)}`);
}

process.stdout.write(`${body}\n`);
