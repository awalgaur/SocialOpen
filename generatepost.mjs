#!/usr/bin/env node
/**
 * Daily post generator with uniqueness guardrail (no near-duplication vs last 15).
 * Requires: Node 18+, repo write permissions (in CI), and secrets set in environment.
 *
 * Env:
 *   AZURE_OPENAI_ENDPOINT
 *   AZURE_OPENAI_KEY
 *   AZURE_OPENAI_DEPLOYMENT
 *   BING_SEARCH_KEY (optional) – improves topical freshness
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd());
const DATA_FILE = path.join(ROOT, 'data', 'posts.json');

const AZ_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZ_KEY = process.env.AZURE_OPENAI_KEY;
const AZ_DEPLOY = process.env.AZURE_OPENAI_DEPLOYMENT;
const BING_KEY = process.env.BING_SEARCH_KEY;

if (!AZ_ENDPOINT || !AZ_KEY || !AZ_DEPLOY) {
  console.error('Missing Azure OpenAI env vars. Please set AZURE_OPENAI_*');
  process.exit(1);
}

const todayISO = new Date().toISOString();

(async function main() {
  const { posts } = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  const last15 = posts.slice(0, 15);
  const trends = await fetchTrends();
  const angle = pickAngle(); // vary POV to boost novelty

  const sys = `You are a senior product strategist writing concise, high-signal LinkedIn posts (<=300 words) about AI + user experience.
- Tone: practical, specific, and human. Avoid buzzwords.
- Include 2–4 bullets if needed. Include 4–7 relevant hashtags at end.
- Cite no links. No emojis unless they help clarity.`;

  const user = `Synthesize a fresh daily post about AI + UX from these topics:
${trends.map((t, i) => `${i+1}. ${t.title} — ${t.snippet}`).join('\n')}
Angle to emphasize today: ${angle}

Constraints:
- <= 300 words
- Add concrete examples
- End with a thoughtful question to spark discussion
- Avoid repeating phrasing from prior posts`;

  const generated = await chat(sys, user);
  const title = deriveTitle(generated);
  const hashtags = deriveHashtags(generated);

  // Uniqueness guardrail vs last 15 posts
  const isUnique = ensureNovelty(generated, last15.map(p => p.html));
  let attempts = 1;
  while (!isUnique.ok && attempts < 5) {
    const altAngle = pickAngle(isUnique.hint);
    const reUser = user + `\n\nRewrite with a different angle: ${altAngle}. Change structure and language; avoid similar phrases to previous content.`;
    const alt = await chat(sys, reUser);
    if (ensureNovelty(alt, last15.map(p => p.html)).ok) {
      writePost(posts, alt, titleFrom(alt), deriveHashtags(alt));
      return;
    }
    attempts++;
  }

  writePost(posts, generated, title, hashtags);

})().catch(err => {
  console.error(err);
  process.exit(1);
});

async function fetchTrends() {
  // Prefer Bing News for fresh AI items. If no key, fall back to curated prompts.
  if (BING_KEY) {
    const q = encodeURIComponent('("artificial intelligence" OR AI) (product OR policy OR UX OR adoption) site:news OR site:blog');
    const url = `https://api.bing.microsoft.com/v7.0/news/search?q=${q}&count=10&safeSearch=Moderate&setLang=en-US&freshness=Day`;
    const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': BING_KEY }});
    const data = await res.json();
    return (data.value || []).map(v => ({
      title: v.name,
      snippet: (v.description || '').replace(/\s+/g, ' ').trim(),
      url: v.url
    })).slice(0, 6);
  }
  // Fallback topics if no Bing key present
  return [
    { title: 'Agentic AI for workflows', snippet: 'Move from prompts to agentic, human-in-the-loop workflows for recruiting, support, and ops.' },
    { title: 'Privacy/consent & model training', snippet: 'Growing expectation for clear opt-out and data minimization in enterprise AI.' },
    { title: 'Evaluation & guardrails', snippet: 'Shift from demos to measurable, task-level evaluations and safety guardrails.' },
    { title: 'On-device and edge AI', snippet: 'Latency and privacy benefits for productivity apps and assistive features.' },
    { title: 'Multimodal UX', snippet: 'Speech + vision + text interactions becoming mainstream in business tools.' },
    { title: 'RAG over enterprise data', snippet: 'More accurate answers via retrieval + verifiable citations inside orgs.' }
  ];
}

function pickAngle(hint) {
  const angles = [
    'User experience: speed, clarity, low-friction flows',
    'Trust & privacy: transparent data use, opt-in, and controls',
    'Change management: onboarding, policy, and enablement',
    'ROI & productivity: time-to-value, adoption metrics',
    'Design patterns: agent handoffs, error states, evaluation'
  ];
  if (hint) angles.push(hint);
  return angles[Math.floor(Math.random() * angles.length)];
}

async function chat(system, user) {
  const url = `${AZ_ENDPOINT}/openai/deployments/${AZ_DEPLOY}/chat/completions?api-version=2024-02-15-preview`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': AZ_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      temperature: 0.7,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI error: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[#*_`~>]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOP.has(t));
}
const STOP = new Set(['the','a','and','or','but','if','then','to','of','in','on','for','at','is','are','be','as','it','that','this','with','by','an','from','we','you','i']);

function cosineSim(a, b) {
  const A = freq(a), B = freq(b);
  const terms = new Set([...Object.keys(A), ...Object.keys(B)]);
  let dot=0, magA=0, magB=0;
  for (const t of terms) {
    const x = A[t] || 0, y = B[t] || 0;
    dot += x*y; magA += x*x; magB += y*y;
  }
  return dot / (Math.sqrt(magA)*Math.sqrt(magB) || 1);
}
function freq(tokens) {
  const f = {};
  tokens.forEach(t => f[t] = (f[t] || 0) + 1);
  return f;
}
function ngrams(tokens, n=3) {
  const out = [];
  for (let i=0;i<=tokens.length-n;i++) out.push(tokens.slice(i,i+n).join(' '));
  return out;
}
function jaccard(aSet, bSet) {
  const inter = new Set([...aSet].filter(x => bSet.has(x)));
  const uni = new Set([...aSet, ...bSet]);
  return inter.size / (uni.size || 1);
}

function ensureNovelty(candidate, recentHtmlArray) {
  const candTokens = tokenize(stripHtml(candidate));
  const candTri = new Set(ngrams(candTokens, 3));
  for (const html of recentHtmlArray) {
    const prev = stripHtml(html);
    const prevTokens = tokenize(prev);
    const cos = cosineSim(candTokens, prevTokens);
    const tri = new Set(ngrams(prevTokens, 3));
    const jac = jaccard(candTri, tri);

    // Thresholds tuned to be conservative
    if (cos > 0.78 || jac > 0.32) {
      return { ok: false, hint: 'Change structure and examples; focus on a different facet (policy, ROI, or onboarding). Avoid repeating phrases.' };
    }
  }
  return { ok: true };
}

function deriveTitle(text) {
  const firstLine = text.split('\n').find(l => l.trim());
  return titleFrom(firstLine || 'AI • UX • Daily Insight');
}
function titleFrom(line) {
  return line.replace(/[#*-]/g,'').trim().slice(0, 100);
}
function deriveHashtags(text) {
  const tags = Array.from(new Set(
    (text.match(/#[A-Za-z0-9_]+/g) || []).map(t => t.replace('#',''))
  ));
  // ensure a few defaults if missing
  const base = ['ArtificialIntelligence','UserExperience','FutureOfWork'];
  for (const b of base) if (!tags.includes(b)) tags.push(b);
  return tags.slice(0, 7);
}
function stripHtml(s='') { return s.replace(/<[^>]+>/g, ' '); }

function writePost(posts, body, title, hashtags) {
  const id = crypto.createHash('sha1').update(body + todayISO).digest('hex').slice(0, 12);
  const html = toHtml(body);
  const entry = {
    id,
    date: todayISO,
    title,
    html,
    hashtags,
    sources: [], // could store from fetchTrends()
    permalink: "" // optional: wire up to detail pages later
  };
  const updated = [entry, ...posts].slice(0, 365); // keep 1 year
  fs.writeFileSync(DATA_FILE, JSON.stringify({ posts: updated }, null, 2));
  console.log(`✅ Wrote post ${id} (${title})`);
}

function toHtml(markdown) {
  // Minimal MD → HTML (paragraphs + bullets). Keep it simple for LinkedIn-style content.
  const lines = markdown.split('\n').map(l => l.trim());
  const out = [];
  let inList = false;
  for (const l of lines) {
    if (/^[-*•]/.test(l)) {
      if (!inList) { out.push('<ul class="bullets">'); inList = true; }
      out.push(`<li>${escapeHtml(l.replace(/^[-*•]\s?/, ''))}</li>`);
    } else if (l === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      out.push(`<p>${escapeHtml(l)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
