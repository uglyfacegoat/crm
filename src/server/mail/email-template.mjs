function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function renderCrmEmail({ eyebrow, title, body, code }) {
  const paragraphs = String(body).split(/\n\n+/).map((part) =>
    `<p style="margin:0 0 16px;color:#5e626a;font-size:15px;line-height:1.65;white-space:pre-line">${escapeHtml(part)}</p>`).join("");
  const codeBlock = code ? `<div style="margin:28px 0;padding:20px 12px;border:1px solid #dfe0dd;border-radius:14px;background:#f6f5f0;text-align:center;color:#181a1e;font-size:32px;font-weight:700;letter-spacing:0.24em;font-variant-numeric:tabular-nums">${escapeHtml(code)}</div>` : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 16px;background:#f6f5f0;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto"><div style="padding:0 4px 22px;color:#181a1e;font-size:22px;font-weight:800;letter-spacing:0.12em">CORE</div><div style="border:1px solid #deded9;border-radius:20px;background:#fff;padding:32px"><div style="margin-bottom:14px;color:#81858c;font-size:11px;font-weight:700;letter-spacing:0.17em;text-transform:uppercase">${escapeHtml(eyebrow)}</div><h1 style="margin:0 0 20px;color:#181a1e;font-size:26px;line-height:1.2">${escapeHtml(title)}</h1>${codeBlock}${paragraphs}</div><p style="margin:18px 4px 0;color:#8a8e94;font-size:12px;line-height:1.5">CORE · Рабочее пространство<br>Это автоматическое письмо. Отвечать на него не нужно.</p></div></body></html>`;
}
