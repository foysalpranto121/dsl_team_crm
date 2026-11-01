// Runs after the Netlify build. Writes dist/_redirects so the site forwards /api, /media and the Django admin
// to the backend. The browser then sees one site, so the sign-in cookie works without any cross-site setup.
import { writeFileSync } from "node:fs";

const api = (process.env.API_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^/\s]+$/.test(api)) {
  console.error("Set API_URL to the backend address, like https://dsl-tos-api.onrender.com (Netlify: Site configuration -> Environment variables).");
  process.exit(1);
}

const rules = [
  ["/api/*", `${api}/api/:splat`, 200],
  ["/media/*", `${api}/media/:splat`, 200],
  ["/django-admin/*", `${api}/django-admin/:splat`, 200],
  ["/static/*", `${api}/static/:splat`, 200],
  ["/*", "/index.html", 200],   // the React app handles every other address
];
writeFileSync("dist/_redirects", rules.map((r) => r.join("  ")).join("\n") + "\n");
console.log(`_redirects written: /api, /media, /django-admin and /static go to ${api}`);
