const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Re-land shared verse links once fonts settle the layout, then enable smooth scrolling.
addEventListener('load', () =>
  document.fonts.ready.then(() => {
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    document.documentElement.classList.toggle('smooth', !reducedMotion);
  }),
);

const verses = $$('.verses li').map((li) => {
  const chapter = li.closest('.chapter');
  return {
    id: li.id,
    ref: `${chapter.dataset.title} ${chapter.dataset.n}:${$('.vnum', li).textContent}`,
    text: $('.vtext', li).textContent,
  };
});

const FEEDBACK = {
  Yea: 'Thy praise hath been logged, for purposes of quality and training.',
  Nay: 'Thy complaint hath been summarized, and the summary lost.',
};

const toast = (() => {
  const el = $('.toast');
  let timer;
  return (message) => {
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 2600);
  };
})();

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
}

// Streams a random verse one token at a time.
let streamTimer;
function reveal() {
  const v = verses[Math.floor(Math.random() * verses.length)];
  const box = $('.revelation');
  const text = $('.revelation-text');
  const ref = $('.revelation-ref');
  box.hidden = false;
  ref.textContent = v.ref;
  ref.href = `#${v.id}`;
  clearInterval(streamTimer);
  // Tokens are laid out up front and faded in, so the box never changes size.
  text.innerHTML = v.text.split(/(?<=\s)/).map((t) => `<span>${escapeHtml(t)}</span>`).join('');
  const spans = [...text.children];
  box.scrollIntoView({ block: 'center' });
  if (reducedMotion) {
    spans.forEach((s) => s.classList.add('on'));
    return;
  }
  let i = 0;
  box.classList.add('streaming');
  streamTimer = setInterval(() => {
    spans[i - 1]?.classList.remove('caret');
    spans[i].classList.add('on', 'caret');
    if (++i < spans.length) return;
    clearInterval(streamTimer);
    spans[i - 1].classList.remove('caret');
    box.classList.remove('streaming');
  }, 55);
}

// Verse search.
const oracle = $('.oracle');
const input = $('input', oracle);
const results = $('.oracle-results', oracle);
input.placeholder = `Prompt ${verses.length} verses...`;

function search() {
  const q = input.value.trim().toLowerCase();
  results.replaceChildren();
  if (!q) return;
  const hits = verses.filter((v) => v.text.toLowerCase().includes(q)).slice(0, 40);
  if (!hits.length) {
    results.innerHTML = '<li class="oracle-empty">The Model found nothing, and is confident about it.</li>';
    return;
  }
  results.innerHTML = hits
    .map((v) => {
      const i = v.text.toLowerCase().indexOf(q);
      const text = escapeHtml(v.text.slice(0, i)) + `<mark>${escapeHtml(v.text.slice(i, i + q.length))}</mark>` + escapeHtml(v.text.slice(i + q.length));
      return `<li><a href="#${v.id}"><span class="oracle-ref">${escapeHtml(v.ref)}</span><span class="oracle-text">${text}</span></a></li>`;
    })
    .join('');
}

function openOracle() {
  oracle.showModal();
  input.select();
  search();
}

input.addEventListener('input', search);
$('form', oracle).addEventListener('submit', () => {
  const first = $('a', results);
  if (first) location.hash = first.hash;
});
oracle.addEventListener('click', (e) => {
  if (e.target === oracle || e.target.closest('.oracle-results a')) oracle.close();
});

// Chapter drawer on narrow screens.
const rail = $('.rail');
const railButton = $('[data-action="chapters"]');
function setRail(open) {
  rail.classList.toggle('open', open);
  railButton.setAttribute('aria-expanded', open);
}

const actions = {
  search: openOracle,
  theme: toggleTheme,
  chapters: () => setRail(!rail.classList.contains('open')),
  reveal,
};

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]');
  if (action) actions[action.dataset.action]();
  else if (!e.target.closest('.rail') || e.target.closest('.rail a')) setRail(false);

  const feedback = e.target.closest('[data-feedback]');
  if (feedback) toast(FEEDBACK[feedback.dataset.feedback] ?? 'Thy feedback shall be used for training.');

  // Copy the verse's own page, which carries the verse in link previews.
  const vnum = e.target.closest('.vnum');
  if (vnum) {
    const [, c, v] = vnum.hash.match(/^#c(\d+)-v(\d+)$/);
    const url = new URL(`${c}/${v}`, location.href.split('#')[0]).href;
    navigator.clipboard?.writeText(url).then(() => toast('The verse is copied unto thy clipboard.'), () => {});
  }
});

addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea');
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    openOracle();
  } else if (e.key === 'Escape') {
    setRail(false);
  }
});

// Reading progress and the current chapter.
const topbar = $('.topbar');
const hero = $('.hero');
let ticking = false;
addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      topbar.style.setProperty('--progress', max > 0 ? scrollY / max : 0);
      topbar.classList.toggle('past-hero', scrollY > hero.offsetHeight * 0.8);
      ticking = false;
    });
  },
  { passive: true },
);

const now = $('.now');
const railList = $('.rail-list');
const railLinks = new Map($$('.rail a').map((a) => [a.hash.slice(1), a]));
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const { id, dataset } = entry.target;
      for (const a of railLinks.values()) a.removeAttribute('aria-current');
      const link = railLinks.get(id);
      link.setAttribute('aria-current', 'true');
      railList.scrollTo({ top: link.offsetTop - railList.clientHeight / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
      now.textContent = `Chapter ${dataset.n}: ${dataset.title}`;
    }
  },
  { rootMargin: '-45% 0px -50% 0px' },
);
$$('.chapter').forEach((c) => observer.observe(c));
