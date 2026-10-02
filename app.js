'use strict';

/* ================================================================
   NEGRET'S list — comportamento do app
   Lista offline (localStorage) + exportação PDF (jsPDF cacheado)
   ================================================================ */

const APP_VERSION = '1.8.13';
const JSPDF_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const KEYS        = { items: 'ench_v2', saved: 'ench_saved', cfg: 'ench_cfg' };
const CFG_DEFAULT = { sort: 'added', strike: true, confirmDel: true, countChecked: false, budget: 0 };

/* ============ utilitários ============ */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

let query = '', editingId = null, itemQty = 1, lastToggled = null;
let lastTotal = null, confirmOk = null, currentSheet = null, deferredPrompt = null;

const saveItems = () => store(KEYS.items, items);
const saveSaved = () => store(KEYS.saved, saved);
const saveCfg   = () => store(KEYS.cfg, cfg);
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
    case 'premium':  openSheet('sheetPremium'); break;
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

 $('#btnNewSkip').addEventListener('click', () => {
  items = []; saveItems(); render(); closeAll(); toast('Nova lista criada');
});
 $('#btnNewSave').addEventListener('click', () => {
  snapshotCurrent($('#newListName').value.trim() || null);
  items = []; saveItems(); render(); closeAll(); toast('Lista salva e nova lista criada');
});
 $('#btnSaveCurrent').addEventListener('click', () => {
  if (!items.length) { toast('A lista atual está vazia'); return; }
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
    const b = document.c
