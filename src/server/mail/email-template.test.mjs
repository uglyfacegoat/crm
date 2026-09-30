import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCrmEmail } from "./email-template.mjs";

test("security email presents the seven-digit code without rendering untrusted markup", () => {
  const html = renderCrmEmail({ eyebrow: "Безопасность", title: "Код входа · CORE",
    body: "Если вы не просили код, игнорируйте <script>alert(1)</script>.", code: "0123456" });
  assert.match(html, /0123456/);
  assert.match(html, /CORE/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
