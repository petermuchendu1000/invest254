import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./authservice.js";
import { InMemoryIdentityRepository } from "./identity.js";
import { verifierFromKey } from "./auth.js";

const SECRET = "test-jwt-secret-please-change";
const SITE_A = "00000000-0000-0000-0000-0000000000aa";
const SITE_B = "00000000-0000-0000-0000-0000000000bb";

function svc() {
  const repo = new InMemoryIdentityRepository();
  const auth = new AuthService(repo, { jwtSecret: SECRET });
  const verify = verifierFromKey(new TextEncoder().encode(SECRET), ["HS256"]);
  return { repo, auth, verify };
}

test("register issues a token carrying the brand's `site` claim", async () => {
  const { auth, verify } = svc();
  const s = await auth.register({ phone: "0712000111", username: "brandAuser", password: "Sup3rSecret!", siteId: SITE_A });
  assert.equal(s.site, SITE_A);
  const claims = await verify(s.token);
  assert.equal(claims.userId, s.userId);
  assert.equal(claims.site, SITE_A, "token must bind to the registering brand");
  assert.equal(claims.role, "player");
});

test("the same phone registers independently on two brands (per-site identity)", async () => {
  const { auth } = svc();
  const a = await auth.register({ phone: "0712000222", username: "samex", password: "Sup3rSecret!", siteId: SITE_A });
  const b = await auth.register({ phone: "0712000222", username: "samex", password: "Sup3rSecret!", siteId: SITE_B });
  assert.notEqual(a.userId, b.userId, "same phone => two separate accounts across brands");
  // duplicate WITHIN a brand is rejected
  await assert.rejects(
    () => auth.register({ phone: "0712000222", username: "other", password: "Sup3rSecret!", siteId: SITE_A }),
    /PHONE_TAKEN/,
  );
});

test("login is scoped to the brand and stamps the site claim", async () => {
  const { auth, verify } = svc();
  await auth.register({ phone: "0712000333", username: "loginA", password: "Sup3rSecret!", siteId: SITE_A });
  // correct brand + password -> token with site A
  const ok = await auth.login({ phone: "0712000333", password: "Sup3rSecret!", siteId: SITE_A });
  assert.equal(ok.site, SITE_A);
  assert.equal((await verify(ok.token)).site, SITE_A);
  // same phone/password but a DIFFERENT brand where no such account exists -> rejected
  await assert.rejects(() => auth.login({ phone: "0712000333", password: "Sup3rSecret!", siteId: SITE_B }), /INVALID_CREDENTIALS/);
});

test("single-tenant (no siteId) still works and omits the site claim", async () => {
  const { auth, verify } = svc();
  const s = await auth.register({ phone: "0712000444", username: "notenant", password: "Sup3rSecret!" });
  assert.equal(s.site, undefined);
  const claims = await verify(s.token);
  assert.equal(claims.site, undefined, "no brand => no site claim (legacy behaviour)");
  const li = await auth.login({ phone: "0712000444", password: "Sup3rSecret!" });
  assert.equal((await verify(li.token)).site, undefined);
});
