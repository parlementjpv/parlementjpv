async function loadPosts() {
  const container = document.getElementById("posts-container");

  const response = await fetch("/posts/");
  if (!response.ok) {
    container.innerHTML = "<p>Aucun post trouvé.</p>";
    return;
  }
}

async function fetchPosts() {
  const repo = "TONUSER/TONREPO"; // À remplacer
  const api = `https://api.github.com/repos/${repo}/contents/posts`;
  const res = await fetch(api);
  const files = await res.json();

  const posts = [];

  for (let file of files) {
    if (file.name.endsWith(".md")) {
      const raw = await fetch(file.download_url);
      const text = await raw.text();
      posts.push(parseFrontMatter(text));
    }
  }

  renderPosts(posts);
}

function parseFrontMatter(text) {
  const match = text.match(/---([\s\S]*?)---/);
  if (!match) return null;

  const data = {};
  match[1].split("\n").forEach(line => {
    const parts = line.split(":");
    if (parts.length > 1) {
      data[parts[0].trim()] = parts.slice(1).join(":").trim();
    }
  });

  return data;
}

function renderPosts(posts){
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  posts.forEach(post => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${post.title}</h3>
      <p>${post.date}</p>
      <p><em>${post.author}</em></p>
      <span class="badge">${post.tags}</span>
    `;
    container.appendChild(card);
  });
}

fetchPosts();
