'use strict';

/* ================================================================
   NEGRET'S list — comportamento do app (versão completa)
   Lista offline (localStorage) + exportação PDF (jsPDF cacheado)
   + Premium vendido via WhatsApp com código de ativação
   ================================================================ */

const APP_VERSION = '1.8.13';
const JSPDF_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const KEYS        = { items: 'ench_v2', saved: 'ench_saved', cfg: 'ench_cfg', prem: 'ench_prem' };
const CFG_DEFAULT = { sort: 'added', strike: true, confirmDel: true, countChecked: false, budget: 0 };

/* ============ Premium (venda via WhatsApp + código) ============ */
const PREMIUM_WPP = '5531982517147'; /* 55 + DDD 31 + 982517147 */
const WPP_MSG = "Olá! Quero assinar o NEGRET'Slist Premium (R$ 9,90/mês).\n\nMeu nome: ";
const FREE_LIST_LIMIT = 3; /* listas salvas permitidas no plano gratuito */

/* Códigos de ativação válidos. Vendeu uma assinatura? Adicione um código
   novo aqui e envie ao cliente pelo WhatsApp. Remova para revogar. */
const PREMIUM_CODES = [
  'NGRT-TESTE',    /* código de teste — remova antes de divulgar */
  'NGRT-7H2K9Q',
  'NGRT-M4XP8T',
  'NGRT-B6RJ3V',
  'NGRT-K9WD5S'
];

/* ============ utilitários ============ */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/* formato próprio para o PDF (evita espaços especiais do Intl dentro do jsPDF) */
const brlPdf = v => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function dateParts(d) {
  d = d || new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return { br: dd + '/' + mm + '/' + yy, file: dd + '-' + mm + '-' + yy };
}

function parsePrice(s) {
  s = String(s == null ? '' : s).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) || v < 0 ? 0 : v;
}

function loadJSON(key, fb) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
  catch (_) { return fb; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

/* ============ estado ============ */
function seed() {
  const t = Date.now();
  return [
    ['Gasolina', 40, true],
    ['Dobradinha', 24, true],
    ['Pernil', 89.90, false],
    ['Arroz 5kg', 32.50, true],
    ['Feijão 1kg', 8.74, true],
    ['Óleo de soja', 9.80, true],
    ['Papel higiênico pct 12', 18.30, true],
    ['Carne bovina 2kg', 395, false]
  ].map((x, i) => ({ id: (t + i).toString(36), n: x[0], p: x[1], q: 1, c: x[2] }));
}

let items = loadJSON(KEYS.items, null);
if (!Array.isArray(items)) { items = seed(); store(KEYS.items, items); }

let saved = loadJSON(KEYS.saved, []);
if (!Array.isArray(saved)) saved = [];

let cfg = Object.assign({}, CFG_DEFAULT, loadJSON(KEYS.cfg, {}));

let premium = loadJSON(KEYS.prem, { active: false });
if (!premium || typeof premium !== 'object') premium = { active: false };

let query = '', editingId = null, itemQty = 1, lastToggled = null;
let lastTotal = null, confirmOk = null, currentSheet = null, deferredPrompt = null;

const saveItems = () => store(KEYS.items, items);
const saveSaved = () => store(KEYS.saved, saved);
const saveCfg   = () => store(KEYS.cfg, cfg);
const savePrem  = () => store(KEYS.prem, premium);
const isPremium = () => !!(premium && premium.active);
const sumTotal  = (list, onlyChecked) =>
  list.reduce((s, i) => (onlyChecked && !i.c) ? s : s + i.p * i.q, 0);

const CHECK_SVG = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
const ICONS = {
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 18 15 15"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
};

/* ============ elementos ============ */
const listEl = $('#list'), listCard = $('#listCard'), emptyState = $('#emptyState'),
      emptyTitle = $('#emptyTitle'), emptyMsg = $('#emptyMsg'),
      countInfo = $('#countInfo'), totalValue = $('#totalValue'), totalLabel = $('#totalLabel'),
      budgetHint = $('#budgetHint'), scrim = $('#scrim'), drawer = $('#drawer'), toastEl = $('#toast');

/* ============ render ============ */
function sortItems(arr) {
  const a = arr.slice();
  switch (cfg.sort) {
    case 'name':      a.sort((x, y) => x.n.localeCompare(y.n, 'pt-BR')); break;
    case 'priceAsc':  a.sort((x, y) => (x.p * x.q) - (y.p * y.q)); break;
    case 'priceDesc': a.sort((x, y) => (y.p * y.q) - (x.p * x.q)); break;
    case 'pending':   a.sort((x, y) => x.c === y.c ? 0 : (x.c ? 1 : -1)); break;
    default:          a.sort((x, y) => x.id < y.id ? -1 : 1);
  }
  return a;
}

function itemRow(it) {
  const li = document.createElement('li');
  li.className = 'item' + (it.c ? ' checked' : '');

  const chk = document.createElement('button');
  chk.className = 'chk' + (it.id === lastToggled ? ' pop' : '');
  chk.setAttribute('aria-label', (it.c ? 'Desmarcar ' : 'Marcar ') + it.n);
  chk.innerHTML = CHECK_SVG;
  chk.addEventListener('click', e => { e.stopPropagation(); toggleItem(it.id); });

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = it.n; /* quebra em várias linhas naturalmente — nunca corta */

  const right = document.createElement('div');
  right.className = 'price';
  if (it.q > 1) {
    const q = document.createElement('span');
    q.className = 'qty'; q.textContent = 'x' + it.q;
    right.appendChild(q);
  }
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = brl(it.p * it.q);
  right.appendChild(val);

  li.append(chk, name, right);
  li.addEventListener('click', () => openItemSheet(it.id));
  return li;
}

function render() {
  const sel = items.filter(i => i.c).length;
  countInfo.textContent =
    items.length + (items.length === 1 ? ' item' : ' itens') + ' • ' +
    sel + (sel === 1 ? ' selecionado' : ' selecionados');

  const view = sortItems(items.filter(i => !query || norm(i.n).includes(norm(query))));
  listEl.innerHTML = '';
  view.forEach(it => listEl.appendChild(itemRow(it)));
  listCard.hidden = view.length === 0;

  if (items.length === 0) {
    emptyTitle.textContent = 'Sua lista está vazia';
    emptyMsg.innerHTML = 'Toque no botão + para adicionar itens.<br>Tudo fica salvo no aparelho, mesmo offline.';
    emptyState.hidden = false;
  } else if (view.length === 0) {
    emptyTitle.textContent = 'Nenhum item encontrado';
    emptyMsg.textContent = 'Nada na lista combina com "' + query + '".';
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
  }

  listCard.classList.toggle('nostrike', !cfg.strike);

  totalLabel.textContent = cfg.countChecked ? 'Total dos marcados' : 'Total';
  const total = sumTotal(items, cfg.countChecked);
  totalValue.textContent = brl(total);
  if (lastTotal !== null && Math.abs(total - lastTotal) > 0.001) {
    totalValue.classList.remove('bump'); void totalValue.offsetWidth; totalValue.classList.add('bump');
  }
  lastTotal = total;

  if (cfg.budget > 0) {
    const rest = cfg.budget - total;
    budgetHint.hidden = false;
    budgetHint.textContent = rest >= 0
      ? 'orçamento ' + brl(cfg.budget) + ' • restam ' + brl(rest)
      : 'orçamento ' + brl(cfg.budget) + ' • excedeu ' + brl(-rest);
    budgetHint.classList.toggle('over', rest < 0);
  } else {
    budgetHint.hidden = true;
  }

  lastToggled = null;
}

/* ============ itens ============ */
function toggleItem(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  it.c = !it.c;
  lastToggled = id;
  saveItems(); render(); buzz(8);
}

function openNewItem() {
  editingId = null; itemQty = 1;
  $('#itemSheetTitle').textContent = 'Novo item';
  $('#itemName').value = ''; $('#itemPrice').value = '';
  $('#qtyVal').textContent = '1';
  $('#btnDelItem').hidden = true;
  openSheet('sheetItem');
  setTimeout(() => $('#itemName').focus(), 340);
}

function openItemSheet(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  editingId = id; itemQty = it.q;
  $('#itemSheetTitle').textContent = 'Editar item';
  $('#itemName').value = it.n;
  $('#itemPrice').value = String(it.p).replace('.', ',');
  $('#qtyVal').textContent = it.q;
  $('#btnDelItem').hidden = false;
  openSheet('sheetItem');
}

function saveItem() {
  const nameEl = $('#itemName');
  const n = nameEl.value.trim();
  if (!n) {
    nameEl.classList.add('err'); nameEl.focus(); buzz(30);
    setTimeout(() => nameEl.classList.remove('err'), 1400);
    return;
  }
  const p = parsePrice($('#itemPrice').value);
  if (editingId) {
    const it = items.find(i => i.id === editingId);
    if (it) { it.n = n; it.p = p; it.q = itemQty; }
    toast('Item atualizado');
  } else {
    items.push({ id: uid(), n, p, q: itemQty, c: false });
    toast('Item adicionado à lista');
  }
  saveItems(); render(); closeAll(); buzz(6);
}

function deleteItem(id) {
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return;
  const removed = items.splice(idx, 1)[0];
  saveItems(); render(); closeAll(); buzz(14);
  toast('Item excluído', 'Desfazer', () => {
    items.splice(Math.min(idx, items.length), 0, removed);
    saveItems(); render();
  });
}

function askDelete() {
  const it = items.find(i => i.id === editingId);
  if (!it) return;
  if (!cfg.confirmDel) { deleteItem(it.id); return; }
  openConfirm({
    title: 'Excluir item',
    msg: 'Remover "' + it.n + '" da lista? Você poderá desfazer pelo aviso.',
    ok: 'Excluir', danger: true,
    onOk: () => deleteItem(it.id)
  });
}

/* ============ sheets / drawer / toast ============ */
function lock(v) { document.body.classList.toggle('locked', v); }

function openSheet(id) {
  drawer.classList.remove('on');
  if (currentSheet && currentSheet !== id) $('#' + currentSheet).classList.remove('on');
  currentSheet = id;
  scrim.classList.add('on');
  $('#' + id).classList.add('on');
  lock(true);
}

function openDrawer() {
  if (currentSheet) { $('#' + currentSheet).classList.remove('on'); currentSheet = null; }
  drawer.classList.add('on');
  scrim.classList.add('on');
  lock(true);
}

function closeAll() {
  scrim.classList.remove('on');
  drawer.classList.remove('on');
  if (currentSheet) { $('#' + currentSheet).classList.remove('on'); currentSheet = null; }
  lock(false);
}

scrim.addEventListener('click', closeAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeAll));
 $('#confCancel').addEventListener('click', closeAll);

let toastTimer = null;
function toast(msg, actionLabel, onAction) {
  toastEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  toastEl.appendChild(span);
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.addEventListener('click', () => {
      clearTimeout(toastTimer); toastEl.classList.remove('on');
      onAction && onAction();
    });
    toastEl.appendChild(b);
  }
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), actionLabel ? 5200 : 2400);
}

function openConfirm(o) {
  $('#confTitle').textContent = o.title || 'Confirmar';
  $('#confMsg').textContent = o.msg || '';
  const ok = $('#confOk');
  ok.textContent = o.ok || 'Confirmar';
  ok.classList.toggle('danger', !!o.danger);
  ok.classList.toggle('primary', !o.danger);
  confirmOk = o.onOk || null;
  openSheet('sheetConfirm');
}
 $('#confOk').addEventListener('click', () => { const cb = confirmOk; closeAll(); cb && cb(); });

/* ============ busca ============ */
 $('#btnSearch').addEventListener('click', () => {
  $('#searchRow').hidden = false; $('#subhead').hidden = true;
  setTimeout(() => $('#searchInput').focus(), 60);
});
 $('#btnSearchClose').addEventListener('click', () => {
  $('#searchRow').hidden = true; $('#subhead').hidden = false;
  $('#searchInput').value = ''; query = ''; render();
});
 $('#searchInput').addEventListener('input', e => { query = e.target.value.trim(); render(); });

/* ============ ordenar ============ */
 $('#btnSort').addEventListener('click', () => {
  document.querySelectorAll('#sortWrap .opt')
    .forEach(o => o.classList.toggle('on', o.dataset.sort === cfg.sort));
  openSheet('sheetSort');
});
 $('#sortWrap').addEventListener('click', e => {
  const opt = e.target.closest('.opt');
  if (!opt) return;
  cfg.sort = opt.dataset.sort; saveCfg(); render(); closeAll();
  toast('Ordenado por: ' + opt.querySelector('span').textContent);
});

/* ============ sheet de item ============ */
 $('#qtyMinus').addEventListener('click', () => { itemQty = Math.max(1, itemQty - 1); $('#qtyVal').textContent = itemQty; });
 $('#qtyPlus').addEventListener('click', () => { itemQty = Math.min(999, itemQty + 1); $('#qtyVal').textContent = itemQty; });
 $('#btnItemSave').addEventListener('click', saveItem);
 $('#btnDelItem').addEventListener('click', askDelete);
 $('#fab').addEventListener('click', openNewItem);
['#itemName', '#itemPrice'].forEach(s =>
  $(s).addEventListener('keydown', e => { if (e.key === 'Enter') saveItem(); })
);

/* ============ drawer ============ */
drawer.addEventListener('click', e => {
  const b = e.target.closest('[data-menu]');
  if (!b) return;
  switch (b.dataset.menu) {
    case 'pdf':      closeAll(); setTimeout(() => exportarPDF(items, 'MINHA LISTA - ' + dateParts().br), 250); break;
    case 'install':  promptInstall(); break;
    case 'new':      closeAll(); setTimeout(openNewListSheet, 260); break;
    case 'lists':    buildListsSheet(); openSheet('sheetLists'); break;
    case 'budget':   openBudgetSheet(); break;
    case 'expenses': buildExpenses(); openSheet('sheetExpenses'); break;
    case 'premium':  renderPremium(); openSheet('sheetPremium'); break;
    case 'settings': syncSettings(); openSheet('sheetSettings'); break;
  }
});
 $('#btnMenu').addEventListener('click', openDrawer);

/* ============ nova lista / listas salvas ============ */
function openNewListSheet() {
  $('#newListName').value = '';
  $('#newListName').placeholder = 'Lista de ' + dateParts().br;
  openSheet('sheetNewList');
}

function snapshotCurrent(name) {
  saved.unshift({
    id: uid(),
    name: name || ('Lista de ' + dateParts().br),
    date: new Date().toISOString(),
    items: items.map(i => ({ id: i.id, n: i.n, p: i.p, q: i.q, c: i.c }))
  });
  saveSaved();
}

/* limite do plano gratuito: 3 listas salvas (Premium libera ilimitadas) */
function checkListQuota() {
  if (isPremium() || saved.length < FREE_LIST_LIMIT) return true;
  openConfirm({
    title: 'Limite do plano gratuito',
    msg: 'No plano gratuito você pode manter até ' + FREE_LIST_LIMIT +
         ' listas salvas. O Premium libera listas ilimitadas.',
    ok: 'Ver Premium',
    onOk() { renderPremium(); openSheet('sheetPremium'); }
  });
  return false;
}

 $('#btnNewSkip').addEventListener('click', () => {
  items = []; saveItems(); render(); closeAll(); toast('Nova lista criada');
});
 $('#btnNewSave').addEventListener('click', () => {
  if (!checkListQuota()) return;
  snapshotCurrent($('#newListName').value.trim() || null);
  items = []; saveItems(); render(); closeAll(); toast('Lista salva e nova lista criada');
});
 $('#btnSaveCurrent').addEventListener('click', () => {
  if (!items.length) { toast('A lista atual está vazia'); return; }
  if (!checkListQuota()) return;
  snapshotCurrent($('#saveName').value.trim() || null);
  $('#saveName').value = '';
  buildListsSheet(); toast('Lista salva com sucesso'); buzz(10);
});

function fmtDate(iso) {
  const d = new Date(iso);
  return dateParts(d).br + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function buildListsSheet() {
  $('#btnSaveCurrent').disabled = !items.length;
  const wrap = $('#savedWrap');
  wrap.innerHTML = '';
  if (!saved.length) {
    const p = document.createElement('p');
    p.className = 'emptynote';
    p.textContent = 'Nenhuma lista salva ainda. Use o campo acima para salvar a lista atual.';
    wrap.appendChild(p);
    return;
  }
  saved.forEach((s, idx) => {
    const row = document.createElement('div'); row.className = 'savedrow';

    const top = document.createElement('div'); top.className = 'top';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name;
    const dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = fmtDate(s.date);
    top.append(nm, dt);

    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = s.items.length + (s.items.length === 1 ? ' item • ' : ' itens • ') + brl(sumTotal(s.items));

    const acts = document.createElement('div'); acts.className = 'acts';
    [['pdf', 'PDF'], ['restore', 'Restaurar'], ['del', 'Excluir']].forEach(([act, label]) => {
      const b = document.createElement('button');
      b.className = 'minibtn' + (act === 'del' ? ' danger' : '');
      b.innerHTML = ICONS[act];
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => {
        if (act === 'pdf') {
          exportarPDF(s.items, s.name.toUpperCase() + ' - ' + dateParts(new Date(s.date)).br);
        } else if (act === 'restore') {
          openConfirm({
            title: 'Restaurar lista',
            msg: 'A lista atual será substituída por "' + s.name + '". Se quiser mantê-la, salve antes em "Nova lista".',
            ok: 'Restaurar',
            onOk() {
              items = s.items.map(i => ({ ...i }));
              saveItems(); render(); toast('Lista "' + s.name + '" restaurada');
            }
          });
        } else {
          openConfirm({
            title: 'Excluir lista salva',
            msg: 'Remover "' + s.name + '" definitivamente?',
            ok: 'Excluir', danger: true,
            onOk() { saved.splice(idx, 1); saveSaved(); buildListsSheet(); toast('Lista salva excluída'); }
          });
        }
      });
      acts.appendChild(b);
    });

    row.append(top, meta, acts);
    wrap.appendChild(row);
  });
}

/* ============ orçamento ============ */
function openBudgetSheet() {
  $('#budgetInput').value = cfg.budget > 0 ? String(cfg.budget).replace('.', ',') : '';
  $('#btnBudgetRemove').hidden = !(cfg.budget > 0);
  updateBudgetPreview();
  openSheet('sheetBudget');
}

function updateBudgetPreview() {
  const v = parsePrice($('#budgetInput').value);
  const info = $('#budgetInfo');
  if (!(v > 0)) { info.innerHTML = ''; return; }
  const t = sumTotal(items, cfg.countChecked);
  const pct = Math.min(100, (t / v) * 100);
  const over = t > v;
  info.innerHTML =
    '<div class="pbar"><i class="' + (over ? 'over' : '') + '" style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<p class="hint' + (over ? ' over' : '') + '">' +
    (over
      ? 'Total atual (' + brl(t) + ') excedeu o orçamento em ' + brl(t - v) + '.'
      : 'Total atual: ' + brl(t) + ' • restam ' + brl(v - t) + ' do orçamento.') +
    '</p>';
}

 $('#budgetInput').addEventListener('input', updateBudgetPreview);
 $('#btnBudgetSave').addEventListener('click', () => {
  const v = parsePrice($('#budgetInput').value);
  cfg.budget = v; saveCfg(); render(); closeAll();
  toast(v > 0 ? 'Orçamento definido: ' + brl(v) : 'Orçamento removido');
});
 $('#btnBudgetRemove').addEventListener('click', () => {
  cfg.budget = 0; saveCfg(); render(); closeAll(); toast('Orçamento removido');
});

/* ============ despesas ============ */
function buildExpenses() {
  const wrap = $('#expensesWrap');
  wrap.innerHTML = '';

  const cur  = sumTotal(items);
  const sumS = saved.reduce((s, x) => s + sumTotal(x.items), 0);

  [
    ['Lista atual', items.length + (items.length === 1 ? ' item' : ' itens'), brl(cur), ''],
    ['Listas salvas', saved.length + (saved.length === 1 ? ' lista arquivada' : ' listas arquivadas'), brl(sumS), ''],
    ['Total acumulado', 'lista atual + arquivadas', brl(cur + sumS), 'total']
  ].forEach(([t, sub, amt, cls]) => {
    const div = document.createElement('div');
    div.className = 'exprow' + (cls ? ' ' + cls : '');
    const left = document.createElement('div');
    const b = document.createElement('b'); b.textContent = t;
    const sm = document.createElement('small'); sm.textContent = sub;
    left.append(b, sm);
    const right = document.createElement('span'); right.className = 'amt'; right.textContent = amt;
    div.append(left, right);
    wrap.appendChild(div);
  });

  if (saved.length) {
    const p = document.createElement('p');
    p.className = 'emptynote';
    p.textContent = 'Arquivadas:';
    wrap.appendChild(p);
    saved.forEach(s => {
      const div = document.createElement('div'); div.className = 'exprow';
      const left = document.createElement('div');
      const b = document.createElement('b'); b.textContent = s.name;
      const sm = document.createElement('small'); sm.textContent = fmtDate(s.date);
      left.append(b, sm);
      const right = document.createElement('span'); right.className = 'amt'; right.textContent = brl(sumTotal(s.items));
      div.append(left, right);
      wrap.appendChild(div);
    });
  }
}

/* ============ premium: WhatsApp + painel de ativação ============ */
function openWhatsApp() {
  const url = 'https://wa.me/' + PREMIUM_WPP + '?text=' + encodeURIComponent(WPP_MSG);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
 $('#btnWpp').addEventListener('click', openWhatsApp);

function renderPremium() {
  const on = isPremium();
  $('#premFree').hidden = on;
  $('#premActive').hidden = !on;
  const chip = $('#premChip');
  chip.textContent = on ? 'ATIVO' : 'PRO';
  chip.classList.toggle('gold', on);
  if (on) {
    const d = premium.since ? new Date(premium.since) : null;
    $('#premMeta').textContent =
      'Ativado em ' + (d ? dateParts(d).br : '—') +
      ' • código ' + (premium.code || '—');
  }
}

function tryActivate() {
  const el = $('#codeInput'), msg = $('#actMsg');
  const raw = (el.value || '').trim();
  if (!raw) {
    msg.textContent = 'Digite o código que você recebeu no WhatsApp.';
    msg.className = 'act-msg err';
    el.focus(); buzz(30);
    return;
  }
  const key = normCode(raw);
  const valid = PREMIUM_CODES.some(c => normCode(c) === key);
  if (!valid) {
    msg.textContent = 'Código inválido. Confira a mensagem que enviamos no WhatsApp.';
    msg.className = 'act-msg err';
    buzz(30);
    return;
  }
  premium = { active: true, code: raw.toUpperCase(), since: new Date().toISOString() };
  savePrem();
  el.value = ''; msg.textContent = ''; msg.className = 'act-msg';
  renderPremium(); buzz(12);
  toast('Premium ativado neste aparelho');
}
 $('#btnActivate').addEventListener('click', tryActivate);
 $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryActivate(); });

 $('#btnDeactivate').addEventListener('click', () => {
  openConfirm({
    title: 'Desativar Premium',
    msg: 'O Premium será desativado neste aparelho. Seu código continua válido — dá para ativar de novo quando quiser.',
    ok: 'Desativar', danger: true,
    onOk() {
      premium = { active: false };
      savePrem(); renderPremium();
      toast('Premium desativado');
    }
  });
});

/* ============ configurações ============ */
function syncSettings() {
  $('#swStrike').checked = cfg.strike;
  $('#swConfirm').checked = cfg.confirmDel;
  $('#swCount').checked = cfg.countChecked;
}
 $('#swStrike').addEventListener('change', e => { cfg.strike = e.target.checked; saveCfg(); render(); });
 $('#swConfirm').addEventListener('change', e => { cfg.confirmDel = e.target.checked; saveCfg(); });
 $('#swCount').addEventListener('change', e => { cfg.countChecked = e.target.checked; saveCfg(); render(); });

 $('#btnExample').addEventListener('click', () => {
  openConfirm({
    title: 'Restaurar exemplo',
    msg: 'A lista atual será substituída pelos 8 itens de exemplo (total ' + brl(618.24) + ').',
    ok: 'Restaurar',
    onOk() { items = seed(); saveItems(); render(); toast('Itens de exemplo restaurados'); }
  });
});

 $('#btnWipe').addEventListener('click', () => {
  openConfirm({
    title: 'Apagar todos os dados',
    msg: 'Lista atual, listas salvas, orçamento, Premium e configurações serão removidos. Não dá para desfazer.',
    ok: 'Apagar tudo', danger: true,
    onOk() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      items = []; saved = []; cfg = { ...CFG_DEFAULT }; premium = { active: false };
      render(); renderPremium();
      toast('Todos os dados foram apagados');
    }
  });
});

/* ============ exportar PDF (funciona offline com o jsPDF cacheado) ============ */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function exportarPDF(listItems, title) {
  if (!listItems || !listItems.length) {
    toast('A lista está vazia — nada para exportar');
    return;
  }

  let JS = window.jspdf && window.jspdf.jsPDF;
  if (!JS) {
    toast('Carregando gerador de PDF…');
    try { await loadScript(JSPDF_URL); JS = window.jspdf && window.jspdf.jsPDF; } catch (_) {}
    if (!JS) {
      toast('PDF indisponível offline. Abra o app online uma vez para cachear o gerador.');
      return;
    }
  }

  const dp = dateParts();
  const doc = new JS({ unit: 'mm', format: 'a4' });
  const M = 15, RIGHT = 195;
  const DARK = [20, 22, 30], MUTED = [138, 143, 168], BLUE = [10, 132, 255];

  /* cabeçalho */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text(title, M, 20);

  const marc = listItems.filter(i => i.c).length;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    listItems.length + (listItems.length === 1 ? ' item' : ' itens') + ' • ' +
    marc + (marc === 1 ? ' selecionado' : ' selecionados'),
    M, 26.5
  );
  doc.setDrawColor(205, 208, 218); doc.setLineWidth(0.2);
  doc.line(M, 30, RIGHT, 30);

  /* itens */
  let y = 39.5;
  doc.setLineHeightFactor(1.35);

  listItems.forEach(it => {
    if (y > 272) { doc.addPage(); y = 22; }

    const subStr = brlPdf(it.p * it.q);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(...(it.c ? MUTED : DARK));
    const lines = doc.splitTextToSize(it.n, 118); /* nome completo, sempre inteiro */
    const nameX = M + 9;

    /* checkbox */
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.35);
    doc.roundedRect(M, y - 3.6, 4.4, 4.4, 1.1, 1.1);
    if (it.c) {
      const cx = M + 2.2, cy = y - 1.4;
      doc.setLineWidth(0.5);
      doc.line(cx - 1.1, cy + 0.1, cx - 0.3, cy + 0.95);
      doc.line(cx - 0.3, cy + 0.95, cx + 1.2, cy - 0.95);
    }

    doc.text(lines, nameX, y);
    if (it.c) { /* riscado desenhado à mão (confiável em qualquer versão do jsPDF) */
      doc.setDrawColor(155, 160, 175); doc.setLineWidth(0.25);
      lines.forEach((ln, i) => {
        const w = Math.min(doc.getTextWidth(ln), 118);
        doc.line(nameX, y + i * 4.9 - 1.25, nameX + w, y + i * 4.9 - 1.25);
      });
    }
    if (it.q > 1) {
      doc.setTextColor(...MUTED);
      doc.text('x' + it.q, RIGHT - doc.getTextWidth(subStr) - 3, y, { align: 'right' });
    }
    doc.setTextColor(...(it.c ? MUTED : DARK));
    doc.text(subStr, RIGHT, y, { align: 'right' });

    y += (lines.length - 1) * 4.9 + 8;
  });

  /* total */
  if (y > 258) { doc.addPage(); y = 22; }
  doc.setDrawColor(...DARK); doc.setLineWidth(0.4);
  doc.line(M, y - 5.5, RIGHT, y - 5.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text('TOTAL', M, y);
  doc.setFontSize(13); doc.setTextColor(...BLUE);
  doc.text(brlPdf(sumTotal(listItems)), RIGHT, y, { align: 'right' });

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("NEGRET'Slist " + APP_VERSION + '  •  Gerado em ' + dp.br + ' às ' + hh + ':' + mi, M, y + 8);

  try {
    doc.save('lista-compras-' + dp.file + '.pdf');
    toast('PDF gerado com sucesso');
  } catch (_) {
    toast('O navegador bloqueou o download do PDF');
  }
}

 $('#btnPdfBar').addEventListener('click', () =>
  exportarPDF(items, 'MINHA LISTA - ' + dateParts().br)
);

/* ============ instalação PWA ============ */
const installItem = $('#installItem');

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (!matchMedia('(display-mode: standalone)').matches) installItem.hidden = false;
});

function promptInstall() {
  if (!deferredPrompt) {
    toast('Use o menu do navegador → "Instalar app" / "Adicionar à tela inicial"');
    closeAll();
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    deferredPrompt = null;
    installItem.hidden = true;
    closeAll();
  });
}

window.addEventListener('appinstalled', () => {
  installItem.hidden = true;
  toast('App instalado! Abra pela tela inicial.');
});

/* ============ service worker (offline) ============ */
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ============ boot ============ */
 $('#verLabel').textContent = 'Versão ' + APP_VERSION;
render();
renderPremium();
