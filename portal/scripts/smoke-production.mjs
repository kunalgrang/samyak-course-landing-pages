const portalUrl = process.env.PORTAL_URL;

if (!portalUrl) {
  console.error("Set PORTAL_URL to the deployed portal origin.");
  process.exit(1);
}

const origin = new URL(portalUrl);

const checks = [
  { path: "/api/health", expectStatus: 200 },
  { path: "/api/version", expectStatus: 200 },
  { path: "/api/public-config", expectStatus: 200 },
  {
    path: "/api/auth/session",
    expectStatus: 200,
    validate: (body) => body && body.authenticated === false,
  },
  {
    path: "/api/student/referrals",
    expectStatus: 401,
  },
];

for (const check of checks) {
  const url = new URL(check.path, origin);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  if (response.status !== check.expectStatus || (check.validate && !check.validate(body))) {
    console.error(`${check.path} failed with HTTP ${response.status}`);
    process.exit(1);
  }
  console.log(`${check.path} ok`);
}

console.log("Production smoke checks passed.");
