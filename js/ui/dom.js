// Tiny DOM helpers.
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

let toastWrap = null;
export function toast(text, cls = '', ms = 2200) {
  if (!toastWrap) { toastWrap = el('div', { class: 'toast-wrap' }); document.getElementById('ui').append(toastWrap); }
  const t = el('div', { class: 'toast ' + cls }, text);
  toastWrap.append(t);
  while (toastWrap.children.length > (document.body.classList.contains("flying") ? 2 : 4)) toastWrap.firstChild.remove();
  setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

export function popEl(e) { if (!e) return; e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }

// Modal dialog; returns { close }
export function modal(title, body, buttons = []) {
  const back = el('div', { class: 'modal-back' });
  const close = () => back.remove();
  const box = el('div', { class: 'modal' },
    el('h2', {}, title),
    body,
    el('div', { class: 'modal-buttons' }, buttons.map((b) => el('button', { class: 'btn ' + (b.cls || ''), onclick: () => { if (b.onclick && b.onclick() === false) return; close(); } }, b.label))));
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.getElementById('ui').append(back);
  return { close, box };
}
