async function load() {
  const res = await fetch('data/posts.json', { cache: 'no-store' });
  const { posts } = await res.json();

  // Latest
  const today = posts[0];
  const todayEl = document.getElementById('today');
  todayEl.className = 'post';
  todayEl.innerHTML = renderPost(today);

  // Archive (skip latest)
  const ul = document.getElementById('postList');
  posts.slice(1, 31).forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a href="${pk || 
        <strong>${new Date(p.date).toLocaleDateString()}</strong> — ${p.title}
      </a>`;
    ul.appendChild(li);
  });

  document.getElementById('year').textContent = new Date().getFullYear();
}

function renderPost(p) {
  return `
    <time datetime="${p.date}">${new Date(p.date).toLocaleDateString()}</time>
    <h4>${p.title}</h4>
    <div class="content">${p.html}</div>
    <div class="hashtags">${(p.hashtags || []).map(h => `#${h}`).join(' ')}</div>
  `;
}

load();
