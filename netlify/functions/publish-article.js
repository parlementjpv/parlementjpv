const crypto = require("crypto");

function slugify(str) {
  return (str || "")
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function nowISO() {
  return new Date().toISOString();
}

async function ghGet(path) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "parlementjpv-netlify-function",
      Accept: "application/vnd.github+json",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  return await res.json();
}

async function ghPut(path, contentString, message, sha = undefined) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  const body = {
    message,
    content: Buffer.from(contentString, "utf8").toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "parlementjpv-netlify-function",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

function articleHTML({ title, author, dateISO, contentHTML, coverUrl, attachments }) {
  const safeTitle = (title || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeAuthor = (author || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cover = coverUrl ? `<img src="${coverUrl}" alt="" style="width:100%;border-radius:16px;max-height:420px;object-fit:cover;margin:16px 0;">` : "";
  const files = (attachments || []).length
    ? `<h3>Pièces jointes</h3><ul>${attachments.map(a => `<li><a href="${a.url}" target="_blank" rel="noopener">${a.label || a.url}</a></li>`).join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle} — Parlement JPV</title>
  <meta name="description" content="${safeTitle}">
  <link rel="icon" href="/assets/img/favicon.png">
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial; margin:0; background:#fafbfc; color:#0a0e1a;}
    .wrap{max-width:900px;margin:0 auto;padding:32px 16px;}
    header a{color:#0b2545;text-decoration:none;font-weight:700}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:24px;box-shadow:0 1px 3px rgba(10,14,26,.06)}
    h1{margin:0 0 8px 0;font-size:clamp(1.6rem,3.5vw,2.4rem)}
    .meta{color:#475569;font-size:.95rem}
    article{margin-top:18px;line-height:1.75;font-size:1.05rem}
    article img{max-width:100%}
  </style>
</head>
<body>
  <div class="wrap">
    <header><a href="/articles/">← Tous les articles</a></header>
    <div class="card">
      <h1>${safeTitle}</h1>
      <div class="meta">Par ${safeAuthor} • ${new Date(dateISO).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>
      ${cover}
      <article>${contentHTML || ""}</article>
      ${files}
    </div>
  </div>
</body>
</html>`;
}

exports.handler = async (event, context) => {
  try {
    // Auth obligatoire
    const user = context.clientContext && context.clientContext.user;
    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    const payload = JSON.parse(event.body || "{}");
    const title = (payload.title || "").trim();
    const contentHTML = (payload.contentHTML || "").trim();
    const coverUrl = (payload.coverUrl || "").trim();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

    if (!title || !contentHTML) {
      return { statusCode: 400, body: JSON.stringify({ error: "title/contentHTML required" }) };
    }

    const author = payload.author?.trim() || (user.user_metadata?.full_name || user.email || "Bureau");
    const dateISO = payload.dateISO || nowISO();

    const baseSlug = slugify(title);
    const unique = crypto.randomBytes(3).toString("hex");
    const slug = payload.slug ? slugify(payload.slug) : `${baseSlug}-${unique}`;

    // 1) écrire la page publique HTML
    const htmlPath = `articles/${slug}/index.html`;
    const existingHtml = await ghGet(htmlPath);
    const html = articleHTML({ title, author, dateISO, contentHTML, coverUrl, attachments });

    await ghPut(
      htmlPath,
      html,
      `Publish article: ${title}`,
      existingHtml?.sha
    );

    // 2) mettre à jour l’index JSON public
    const indexPath = `articles/index.json`;
    const existingIndex = await ghGet(indexPath);

    let index = [];
    if (existingIndex?.content) {
      const decoded = Buffer.from(existingIndex.content, "base64").toString("utf8");
      index = JSON.parse(decoded || "[]");
    }

    const item = {
      slug,
      title,
      author,
      dateISO,
      coverUrl,
      excerpt: payload.excerpt?.trim() || "",
      url: `/articles/${slug}/`,
    };

    // ajoute en tête (plus récent d'abord)
    index = [item, ...index.filter(x => x.slug !== slug)];

    await ghPut(
      indexPath,
      JSON.stringify(index, null, 2),
      `Update articles index (${slug})`,
      existingIndex?.sha
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, slug, url: item.url }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
