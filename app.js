// assets/app.js
function $(sel) { return document.querySelector(sel); }
function showError(msg) {
  const box = document.createElement('div');
  box.style.background = '#fff5f5';
  box.style.border = '1px solid #ffd6d6';
  box.style.color = '#b00020';
  box.style.padding = '12px';
  box.style.borderRadius = '8px';
  box.style.margin = '12px 0';
  box.innerText = msg;
  document.querySelector('main .container, main, body').prepend(box);
  console.error(msg);
}

function computeBasePath() {
  // Ensures correct path for project pages: https://user.github.io/repo/
  // Returns something like '/repo/' or '/' (always trailing slash).
  const p = window.location.pathname;
  return p.endsWith('/') ? p : p.replace(/[^/]+$/, '');
}

function buildUrl(rel) {
  const base = computeBasePath();
  const abs = new URL(rel, window.location.origin + base);
  return abs.toString();
}

function renderPost(p) {
  return `
    <time datetime="${p.date}">${new Date(p.date).toLocaleDateString()}</time>
    <h4>${p.title}</h4>
    <div class="content">${p.html}</div>
    <div class="hashtags">${(p.hashtags || []).map(h => `#${h}`).join(' ')}</div>
  `;
}

async function load() {
  try {
    const dataUrl = buildUrl('data/posts.json');
    const res = await fetch(dataUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${dataUrl}`);
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error(`JSON parse error for ${dataUrl}. Did the request return HTML (404 page)? Original error: ${e.message}`);
    }

    const posts = json?.posts;
    if (!Array.isArray(posts) || posts.length === 0) {
      throw new Error(`No posts found in data/posts.json. Ensure it contains { "posts": [ { ... } ] } with at least one entry.`);
    }

    // Latest
    const today = posts[0];
    const todayEl = $('#today');
    if (!todayEl) throw new Error('Missing #today element in index.html');
    todayEl.className = 'post';
    todayEl.innerHTML = renderPost(today);

    // Archive
    const ul = $('#postList');
    if (ul) {
      posts.slice(1, 31).forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
          ${p.permalink || 
            <strong>${new Date(p.date).toLocaleDateString()}</strong> — ${p.title}
          </a>`;
        ul.appendChild(li);
      });
    }

    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  } catch (err) {
    showError(`⚠️ Unable to render posts: ${err.message}`);
  }
}

load();
