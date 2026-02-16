async function ghDelete(path, sha) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "parlementjpv-netlify-function",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: `Delete ${path}`, sha, branch }),
  });

  if (!res.ok) throw new Error(`GitHub DELETE ${path} failed: ${res.status} ${await res.text()}`);
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

exports.handler = async (event, context) => {
  try {
    const user = context.clientContext && context.clientContext.user;
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

    const { slug } = JSON.parse(event.body || "{}");
    if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "slug required" }) };

    const htmlPath = `articles/${slug}/index.html`;
    const htmlFile = await ghGet(htmlPath);
    if (htmlFile) await ghDelete(htmlPath, htmlFile.sha);

    // update index.json
    const indexPath = `articles/index.json`;
    const indexFile = await ghGet(indexPath);
    if (indexFile?.content) {
      const decoded = Buffer.from(indexFile.content, "base64").toString("utf8");
      let index = JSON.parse(decoded || "[]");
      index = index.filter(x => x.slug !== slug);

      // put back
      const owner = process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_REPO;
      const branch = process.env.GITHUB_BRANCH || "main";
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(indexPath)}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "User-Agent": "parlementjpv-netlify-function",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Update articles index (delete ${slug})`,
          content: Buffer.from(JSON.stringify(index, null, 2), "utf8").toString("base64"),
          sha: indexFile.sha,
          branch,
        }),
      });
      if (!res.ok) throw new Error(`GitHub PUT index.json failed: ${res.status} ${await res.text()}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
