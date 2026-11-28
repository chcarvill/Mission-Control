/* Omnis: portfolio map for Mission Control.
   Projects, the spreadsheets inside them, links to those spreadsheets, and a
   diagram of how each spreadsheet's tabs feed one another.
   Saved in this browser only, under localStorage key "mc_omnis". */
(function () {
  "use strict";
  var KEY = "mc_omnis";
  var P = document.getElementById("omnis-panel");
  if (!P) return;

  var TY = ["data", "auto", "ref", "note"];
  var TL = { data: "Enter data", auto: "Automatic", ref: "Reference", note: "Notes" };
  function T(id, name, type) { return { id: id, name: name, type: type }; }

  function seed() {
    return {
      projects: [
        { id: "ec", name: "EduCobber lesson tracker", color: "#60a5fa", files: [{ id: "ecf", name: "EduCobber lesson tracker", url: "", tabs: [
          T("ec-ov", "Overview", "auto"), T("ec-pi", "Pipelines", "ref"), T("ec-le", "Lessons", "data"), T("ec-dl", "Drafting Lessons", "note"),
          T("ec-db", "Drafting Edu Books", "note"), T("ec-bg", "Books and Games", "data"), T("ec-li", "Lists", "ref"), T("ec-rm", "Read me", "ref")] }] },
        { id: "cp", name: "Card Portfolio Organiser", color: "#f59e0b", files: [{ id: "cpf", name: "Card Portfolio Organiser", url: "", tabs: [
          T("cp-sh", "Start Here", "ref"), T("cp-pi", "Pipeline", "note"), T("cp-su", "Summary", "auto"), T("cp-de", "Designs", "data"),
          T("cp-aw", "Artwork", "data"), T("cp-sf", "Storage files", "ref"), T("cp-av", "Availability", "data"), T("cp-ph", "Photos", "data")] }] }
      ],
      links: [["ec-li", "ec-le"], ["ec-le", "ec-ov"], ["cp-de", "cp-su"], ["cp-av", "cp-su"], ["cp-ph", "cp-su"],
              ["cp-aw", "cp-su"], ["cp-aw", "cp-av"], ["cp-de", "cp-av"], ["cp-de", "cp-ph"]]
    };
  }

  var S, edit = false, linking = false, pend = null, view = null, armed = null, dragId = null;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !Array.isArray(S.projects) || !Array.isArray(S.links)) { S = seed(); save(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // ---------- styles (scoped to #omnis-panel, built on the app's own tokens) ----------
  var css = [
    "#omnis-panel [hidden]{display:none!important}",
    "#omnis-panel .om-wrap{padding:1.25rem 2.5rem 3rem}",
    "@media (max-width:700px){#omnis-panel .om-wrap{padding:1rem 1rem 2.5rem}}",
    "#omnis-panel .om-head{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-hint)}",
    "#omnis-panel .om-lead{font-family:var(--sans);font-size:11px;color:var(--text-hint);margin:4px 0 14px;font-style:italic;max-width:70ch}",
    "#omnis-panel .om-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}",
    "#omnis-panel .pf-iconbtn.on{color:var(--active);border-color:var(--active);background:var(--active-bg)}",
    "#omnis-panel .pf-iconbtn.armed{color:#f87171;border-color:#f87171}",
    "#omnis-panel .om-hint{display:none;font-family:var(--sans);font-size:12px;color:var(--text-secondary);margin:0 0 10px}",
    "#omnis-panel.om-linking .om-hint{display:block}",
    "#omnis-panel .om-toast{font-family:var(--sans);font-size:12px;color:var(--text-secondary);min-height:18px;margin:0 0 8px}",
    "#omnis-panel .om-key{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 16px;font-family:var(--sans);font-size:11px;color:var(--text-hint)}",
    "#omnis-panel .om-key .om-chip{padding:2px 9px;pointer-events:none;min-height:0;font-size:11px;--c:var(--text-secondary)}",
    "#omnis-panel .om-stage{position:relative}",
    "#omnis-panel .om-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;align-items:start}",
    "#omnis-panel .om-card,#omnis-panel .om-proj{background:var(--surface);border:.5px solid var(--border2);border-top:3px solid var(--c);border-radius:var(--radius);overflow:hidden}",
    "#omnis-panel .om-proj{max-width:640px}",
    "#omnis-panel .om-ph{padding:14px 16px 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}",
    "#omnis-panel .om-nm{font-family:var(--sans);font-size:16px;font-weight:600;color:var(--text);text-decoration:none}",
    "#omnis-panel a.om-nm:hover{color:var(--c)}",
    "#omnis-panel .om-ph input[type=color]{width:30px;height:26px;padding:0;border:.5px solid var(--border2);border-radius:6px;background:none;cursor:pointer}",
    "#omnis-panel .om-fl{list-style:none;margin:0;padding:0 16px 10px}",
    "#omnis-panel .om-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 0;border-top:.5px solid var(--border)}",
    "#omnis-panel .om-row:first-child{border-top:0}",
    "#omnis-panel .om-row .om-fn{flex:1 1 120px;font-family:var(--sans);font-size:13px;color:var(--text)}",
    "#omnis-panel .om-grip{display:none;cursor:grab;color:var(--text-hint);user-select:none}",
    "#omnis-panel.om-edit .om-grip{display:inline}",
    "#omnis-panel .om-ib{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:.5px solid var(--border2);border-radius:8px;background:none;color:var(--c);cursor:pointer;padding:0;text-decoration:none}",
    "#omnis-panel .om-ib:hover{border-color:var(--c);background:var(--surface2)}",
    "#omnis-panel .om-ib.off{color:var(--text-hint);opacity:.5;cursor:default}",
    "#omnis-panel .om-ib.off:hover{border-color:var(--border2);background:none}",
    "#omnis-panel .om-ib svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
    "#omnis-panel .om-url{flex:1 1 100%;font-family:var(--sans);font-size:12.5px;color:var(--text);background:var(--surface2);border:.5px solid var(--border2);border-radius:var(--radius-sm);padding:7px 9px}",
    "#omnis-panel .om-url:focus{outline:none;border-color:var(--text-hint)}",
    "#omnis-panel .om-locs{flex:1 1 100%;display:flex;flex-direction:column;gap:3px;min-width:0}",
    "#omnis-panel .om-loc{display:flex;gap:6px;min-width:0;font-family:var(--mono);font-size:11px;color:var(--text-hint)}",
    "#omnis-panel .om-loc>span:first-child{flex:none}",
    "#omnis-panel .om-loc .om-val{min-width:0;word-break:break-all}",
    "#omnis-panel .om-loc a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c);text-decoration:none}",
    "#omnis-panel .om-loc a:hover{text-decoration:underline}",
    "#omnis-panel.om-edit .om-row .om-locs{display:none}",
    "#omnis-panel .om-fh+.om-locs{margin:-3px 0 9px}",
    "#omnis-panel .om-foot{padding:0 16px 14px}",
    "#omnis-panel .om-ed{display:none}",
    "#omnis-panel.om-edit .om-ed{display:flex;gap:6px;align-items:center}",
    "#omnis-panel .om-back{font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:var(--text-secondary);text-decoration:none;display:inline-block;margin:0 0 12px;border:.5px solid var(--border2);border-radius:20px;padding:4px 12px;background:none;cursor:pointer}",
    "#omnis-panel .om-back:hover{color:var(--active);border-color:var(--active)}",
    "#omnis-panel .om-pb{padding:4px 12px 14px;display:flex;flex-direction:column;gap:12px}",
    "#omnis-panel .om-file{border:.5px solid var(--border);border-radius:var(--radius-sm);padding:10px;background:var(--bg)}",
    "#omnis-panel .om-fh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:9px}",
    "#omnis-panel .om-fh .om-nm{font-size:13.5px;flex:1 1 auto}",
    "#omnis-panel .om-fh .om-ib{width:30px;height:30px}",
    "#omnis-panel .om-tabs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:7px}",
    "#omnis-panel .om-chip{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 9px;border:1px solid var(--c);border-radius:var(--radius-sm);background:var(--surface2);font-family:var(--sans);font-size:12.5px;color:var(--text);min-height:32px}",
    "#omnis-panel .om-chip.t-data{background:color-mix(in srgb,var(--c) 18%,var(--surface2));font-weight:600}",
    "#omnis-panel .om-chip.t-auto{border-style:dashed}",
    "#omnis-panel .om-chip.t-ref{border-color:var(--border2);border-width:.5px}",
    "#omnis-panel .om-chip.t-note{border-color:var(--border2);border-width:.5px;color:var(--text-secondary);font-style:italic}",
    "#omnis-panel .om-chip .om-ed .pf-iconbtn{padding:0 6px;font-size:10px}",
    "#omnis-panel .om-chip.pend{outline:2px solid var(--text);outline-offset:2px}",
    "#omnis-panel .om-chip.rel{box-shadow:0 0 0 2px var(--text)}",
    "#omnis-panel.om-linking .om-chip{cursor:crosshair}",
    "#omnis-panel [contenteditable=true]{outline:1px dashed var(--text-hint);outline-offset:2px;border-radius:2px;cursor:text}",
    "#omnis-panel .om-empty{font-family:var(--sans);font-size:12.5px;color:var(--text-hint)}",
    "#omnis-panel .om-lines{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}",
    "#omnis-panel .om-lines line{stroke:var(--text-secondary);stroke-width:1.5;opacity:.55}",
    "#omnis-panel .om-lines.dim line{opacity:.08}",
    "#omnis-panel .om-lines.dim line.on{opacity:1;stroke:var(--text);stroke-width:2.2}",
    "#omnis-panel dialog{background:var(--surface);color:var(--text);border:.5px solid var(--border2);border-radius:var(--radius);width:min(560px,92vw);padding:1.1rem}",
    "#omnis-panel dialog::backdrop{background:rgba(0,0,0,.6)}",
    "#omnis-panel textarea{width:100%;height:240px;font-family:var(--mono);font-size:11.5px;line-height:1.4;background:var(--surface2);color:var(--text);border:.5px solid var(--border2);border-radius:var(--radius-sm);padding:8px}",
    "#omnis-panel .om-btnrow{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}"
  ].join("\n");
  var st = document.createElement("style");
  st.id = "omnis-styles";
  st.textContent = css;
  document.head.appendChild(st);

  // ---------- skeleton ----------
  P.innerHTML =
    '<div class="om-wrap">' +
      '<div class="om-head">Omnis \u2014 projects and spreadsheets</div>' +
      '<div class="om-lead">Choose a project. Beside each spreadsheet, the grid icon opens the file and the diagram icon shows how its tabs connect. Saved in this browser only (it is not part of Portfolio \u2192 Export backup); use Save or load layout while editing to keep a copy.</div>' +
      '<div class="om-bar">' +
        '<button class="pf-iconbtn" id="om-edit">Edit layout</button>' +
        '<button class="pf-iconbtn" id="om-addp" hidden>Add project</button>' +
        '<button class="pf-iconbtn" id="om-link" hidden>Draw links</button>' +
        '<button class="pf-iconbtn" id="om-data" hidden>Save or load layout</button>' +
        '<button class="pf-iconbtn" id="om-reset" hidden>Reset to start</button>' +
      '</div>' +
      '<p class="om-hint">Click a tab, then the tab it feeds. Click the same pair again to remove that line.</p>' +
      '<p class="om-toast" id="om-toast" role="status"></p>' +
      '<div class="om-key" id="om-key" hidden><span class="om-chip t-data">Enter data</span><span class="om-chip t-auto">Automatic</span><span class="om-chip t-ref">Reference</span><span class="om-chip t-note">Notes</span><span>An arrowhead means \u201cfeeds into\u201d. Hover a tab to trace its lines.</span></div>' +
      '<div class="om-stage" id="om-stage"><div id="om-view"></div>' +
        '<svg class="om-lines" id="om-lines" aria-hidden="true"><defs><marker id="om-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9z" style="fill:#8b909a"/></marker></defs></svg>' +
      '</div>' +
      '<dialog id="om-dlg"><strong style="font-family:var(--sans);font-size:14px">Save or load layout</strong>' +
        '<p class="om-empty" style="margin:6px 0 10px">Copy this text somewhere safe to keep a backup, including your spreadsheet links. To restore, paste it here and choose Load.</p>' +
        '<textarea id="om-json" spellcheck="false"></textarea><p class="om-empty" id="om-msg" style="margin-top:8px"></p>' +
        '<div class="om-btnrow"><button class="pf-iconbtn" id="om-load">Load this layout</button><button class="pf-iconbtn" id="om-close">Close</button></div></dialog>' +
    '</div>';

  function $(id) { return P.querySelector("#" + id); }
  var V = $("om-view"), L = $("om-lines");

  // ---------- helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return "x" + Math.random().toString(36).slice(2, 8); }
  function okc(c) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#8b909a"; }
  function okurl(u) { return /^https:\/\//i.test(u || ""); }
  function ce() { return edit && !linking ? "true" : "false"; }
  function toast(m) { $("om-toast").textContent = m; }
  var IG = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>';
  var ID = '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.3 7l7.4 4M8.3 17l7.4-4"/></svg>';

  function find(k, id) {
    for (var i = 0; i < S.projects.length; i++) {
      var p = S.projects[i];
      if (k === "p" && p.id === id) return p;
      for (var j = 0; j < p.files.length; j++) {
        var f = p.files[j];
        if (k === "f" && f.id === id) return f;
        for (var m = 0; m < f.tabs.length; m++) if (k === "t" && f.tabs[m].id === id) return f.tabs[m];
      }
    }
    return null;
  }

  function openBtn(f) {
    return okurl(f.url)
      ? '<a class="om-ib" href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer" title="Open the spreadsheet" aria-label="Open ' + esc(f.name) + '">' + IG + '</a>'
      : '<span class="om-ib off" title="No link yet. Choose Edit layout to add one." role="img" aria-label="No link yet for ' + esc(f.name) + '">' + IG + '</span>';
  }
  function delLabel(key) { return armed === key ? "Click again to delete" : "Delete"; }

  function locs(f) {
    var h = "";
    if (okurl(f.url)) h += '<div class="om-loc"><span>Online:</span><a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(f.url) + '">' + esc(f.url) + '</a></div>';
    if (f.loc) h += '<div class="om-loc"><span>Saved at:</span><span class="om-val">' + esc(f.loc) + '</span></div>';
    return h ? '<div class="om-locs">' + h + '</div>' : "";
  }

  function row(f, p) {
    return '<li class="om-row" data-f="' + esc(f.id) + '"><span class="om-grip" title="Drag to another project">\u22ee\u22ee</span>' +
      '<span class="om-fn" data-e="f:' + esc(f.id) + '" contenteditable="' + ce() + '">' + esc(f.name) + '</span>' + openBtn(f) +
      '<button class="om-ib" data-act="open" data-p="' + esc(p.id) + '" title="See how the tabs connect" aria-label="Show details for ' + esc(f.name) + '">' + ID + '</button>' +
      '<span class="om-ed"><button class="pf-iconbtn' + (armed === "f" + f.id ? " armed" : "") + '" data-act="delf" data-f="' + esc(f.id) + '">' + delLabel("f" + f.id) + '</button></span>' +
      locs(f) +
      '<input class="om-ed om-url" data-url="' + esc(f.id) + '" value="' + esc(f.url || "") + '" placeholder="Paste the spreadsheet link (https://\u2026)" aria-label="Link for ' + esc(f.name) + '">' +
      '<input class="om-ed om-url" data-loc="' + esc(f.id) + '" maxlength="300" value="' + esc(f.loc || "") + '" placeholder="Where it lives on your computer (a note only, not a link)" aria-label="Location note for ' + esc(f.name) + '"></li>';
  }
  function card(p) {
    return '<section class="om-card" data-p="' + esc(p.id) + '" style="--c:' + okc(p.color) + '"><div class="om-ph">' +
      (edit ? '<span class="om-nm" data-e="p:' + esc(p.id) + '" contenteditable="' + ce() + '">' + esc(p.name) + '</span>'
            : '<a class="om-nm" href="#" data-act="open" data-p="' + esc(p.id) + '">' + esc(p.name) + '</a>') +
      '<span class="om-ed"><input type="color" value="' + okc(p.color) + '" data-col="' + esc(p.id) + '" aria-label="Project colour">' +
      '<button class="pf-iconbtn' + (armed === "p" + p.id ? " armed" : "") + '" data-act="delp" data-p="' + esc(p.id) + '">' + delLabel("p" + p.id) + '</button></span></div>' +
      '<ul class="om-fl">' + (p.files.map(function (f) { return row(f, p); }).join("") || '<li class="om-empty">No spreadsheets yet.</li>') + '</ul>' +
      '<div class="om-ed om-foot"><button class="pf-iconbtn" data-act="addf" data-p="' + esc(p.id) + '">Add spreadsheet</button></div></section>';
  }
  function fileHtml(f) {
    return '<div class="om-file" data-f="' + esc(f.id) + '"><div class="om-fh"><span class="om-nm" data-e="f:' + esc(f.id) + '" contenteditable="' + ce() + '">' + esc(f.name) + '</span>' + openBtn(f) +
      '<span class="om-ed"><button class="pf-iconbtn" data-act="addt" data-f="' + esc(f.id) + '">Add tab</button></span></div>' +
      locs(f) + '<div class="om-tabs">' +
      (f.tabs.map(function (t) {
        return '<div class="om-chip t-' + esc(t.type) + '" data-t="' + esc(t.id) + '" title="' + esc(TL[t.type] || "") + '"><span data-e="t:' + esc(t.id) + '" contenteditable="' + ce() + '">' + esc(t.name) + '</span>' +
          '<span class="om-ed"><button class="pf-iconbtn" data-act="ty" data-t="' + esc(t.id) + '" title="Change type">' + esc(TL[t.type] || "") + '</button>' +
          '<button class="pf-iconbtn" data-act="delt" data-t="' + esc(t.id) + '" aria-label="Delete tab">\u00d7</button></span></div>';
      }).join("") || '<p class="om-empty">No tabs yet.</p>') + '</div></div>';
  }
  function detail(p) {
    return '<button class="om-back" data-act="home">\u2190 All projects</button>' +
      '<section class="om-proj" style="--c:' + okc(p.color) + '"><div class="om-ph"><span class="om-nm" data-e="p:' + esc(p.id) + '" contenteditable="' + ce() + '">' + esc(p.name) + '</span></div><div class="om-pb">' +
      (p.files.map(fileHtml).join("") || '<p class="om-empty">No spreadsheets yet. Go back, choose Edit layout, then Add spreadsheet.</p>') + '</div></section>';
  }

  // ---------- render ----------
  function render() {
    var pr = view && find("p", view);
    if (!pr) { view = null; linking = false; }
    P.classList.toggle("om-edit", edit);
    P.classList.toggle("om-linking", linking);
    $("om-addp").hidden = !(edit && !pr);
    $("om-link").hidden = !(edit && pr);
    $("om-data").hidden = !edit;
    $("om-reset").hidden = !(edit && !pr);
    $("om-key").hidden = !pr;
    V.innerHTML = pr ? detail(pr)
      : (S.projects.length ? '<div class="om-grid">' + S.projects.map(card).join("") + '</div>'
                           : '<p class="om-empty">No projects yet. Choose Edit layout, then Add project.</p>');
    $("om-edit").textContent = edit ? "Done editing" : "Edit layout";
    $("om-edit").classList.toggle("on", edit);
    $("om-link").textContent = linking ? "Stop drawing links" : "Draw links";
    $("om-link").classList.toggle("on", linking);
    $("om-reset").textContent = armed === "reset" ? "Click again to reset" : "Reset to start";
    $("om-reset").classList.toggle("armed", armed === "reset");
    requestAnimationFrame(draw);
  }

  function pt(A, B) {
    var cx = A.x + A.w / 2, cy = A.y + A.h / 2, dx = B.x + B.w / 2 - cx, dy = B.y + B.h / 2 - cy;
    var s = Math.min(A.w / 2 / Math.abs(dx || 1e-9), A.h / 2 / Math.abs(dy || 1e-9));
    return [cx + dx * s, cy + dy * s];
  }
  function draw() {
    if (P.offsetParent === null) return; // panel hidden: nothing to measure
    var stage = $("om-stage"), sr = stage.getBoundingClientRect(), R = {};
    L.setAttribute("width", stage.scrollWidth);
    L.setAttribute("height", stage.scrollHeight);
    V.querySelectorAll(".om-chip").forEach(function (c) {
      var r = c.getBoundingClientRect();
      R[c.dataset.t] = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
    });
    L.querySelectorAll("line").forEach(function (n) { n.remove(); });
    S.links.forEach(function (l) {
      var a = l[0], b = l[1];
      if (!R[a] || !R[b]) return;
      var p = pt(R[a], R[b]), q = pt(R[b], R[a]), n = document.createElementNS("http://www.w3.org/2000/svg", "line");
      n.setAttribute("x1", p[0]); n.setAttribute("y1", p[1]); n.setAttribute("x2", q[0]); n.setAttribute("y2", q[1]);
      n.setAttribute("marker-end", "url(#om-ah)");
      n.dataset.a = a; n.dataset.b = b;
      L.appendChild(n);
    });
  }

  // ---------- state changes ----------
  function clean() {
    var ids = {};
    S.projects.forEach(function (p) { p.files.forEach(function (f) { f.tabs.forEach(function (t) { ids[t.id] = 1; }); }); });
    S.links = S.links.filter(function (l) { return ids[l[0]] && ids[l[1]]; });
  }
  function done() { armed = null; clean(); save(); render(); }
  function ask(k) {
    if (armed === k) return true;
    armed = k; render();
    setTimeout(function () { if (armed === k) { armed = null; render(); } }, 4000);
    return false;
  }

  P.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (b && P.contains(b)) {
      var d = b.dataset;
      if (d.act === "open") { e.preventDefault(); view = d.p; pend = null; armed = null; render(); window.scrollTo(0, 0); return; }
      if (d.act === "home") { view = null; linking = false; pend = null; armed = null; render(); return; }
      if (d.act === "addf") find("p", d.p).files.push({ id: uid(), name: "New spreadsheet", url: "", tabs: [] });
      else if (d.act === "addt") find("f", d.f).tabs.push(T(uid(), "New tab", "data"));
      else if (d.act === "ty") { var t = find("t", d.t); t.type = TY[(TY.indexOf(t.type) + 1) % TY.length]; }
      else if (d.act === "delt") S.projects.forEach(function (p) { p.files.forEach(function (f) { f.tabs = f.tabs.filter(function (x) { return x.id !== d.t; }); }); });
      else if (d.act === "delf") { if (!ask("f" + d.f)) return; S.projects.forEach(function (p) { p.files = p.files.filter(function (f) { return f.id !== d.f; }); }); }
      else if (d.act === "delp") { if (!ask("p" + d.p)) return; S.projects = S.projects.filter(function (p) { return p.id !== d.p; }); }
      return done();
    }
    var c = e.target.closest(".om-chip[data-t]");
    if (c && linking && V.contains(c)) {
      var id = c.dataset.t;
      if (!pend) { pend = id; c.classList.add("pend"); return; }
      if (pend !== id) {
        var i = -1;
        S.links.forEach(function (l, k) { if (l[0] === pend && l[1] === id) i = k; });
        if (i >= 0) S.links.splice(i, 1); else S.links.push([pend, id]);
      }
      pend = null; done();
    }
  });

  $("om-edit").onclick = function () { edit = !edit; if (!edit) linking = false; pend = null; armed = null; toast(""); render(); };
  $("om-link").onclick = function () { linking = !linking; pend = null; render(); };
  $("om-addp").onclick = function () { S.projects.push({ id: uid(), name: "New project", color: "#2bce8c", files: [] }); done(); };
  $("om-reset").onclick = function () { if (ask("reset")) { S = seed(); done(); } };

  P.addEventListener("focusout", function (e) {
    var n = e.target.closest && e.target.closest("[data-e]");
    if (!n) return;
    var parts = n.dataset.e.split(":"), o = find(parts[0], parts[1]);
    if (o) { o.name = n.textContent.trim() || o.name; n.textContent = o.name; save(); draw(); }
  });
  P.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-e]")) { e.preventDefault(); e.target.blur(); }
  });
  P.addEventListener("input", function (e) {
    var i = e.target.dataset && e.target.dataset.col;
    if (i) { var p = find("p", i); p.color = e.target.value; e.target.closest(".om-card").style.setProperty("--c", p.color); save(); }
  });
  P.addEventListener("change", function (e) {
    var lc = e.target.dataset && e.target.dataset.loc;
    if (lc) { var lf = find("f", lc); lf.loc = e.target.value.trim(); toast(lf.loc ? "Location note saved." : "Location note removed."); save(); render(); return; }
    var i = e.target.dataset && e.target.dataset.url;
    if (!i) return;
    var f = find("f", i), v = e.target.value.trim();
    if (v && !okurl(v)) { toast("Links must start with https:// (for example the share link from Google Drive, OneDrive or Proton Drive)."); e.target.value = f.url || ""; return; }
    f.url = v; toast(v ? "Link saved." : "Link removed."); save(); render();
  });

  V.addEventListener("mouseover", function (e) {
    var c = e.target.closest(".om-chip[data-t]");
    if (!c || linking) return;
    var id = c.dataset.t, any = false;
    L.querySelectorAll("line").forEach(function (n) {
      var m = n.dataset.a === id || n.dataset.b === id;
      n.classList.toggle("on", m);
      if (m) {
        any = true;
        [n.dataset.a, n.dataset.b].forEach(function (x) {
          var r = V.querySelector('.om-chip[data-t="' + x + '"]');
          if (r && x !== id) r.classList.add("rel");
        });
      }
    });
    L.classList.toggle("dim", any);
  });
  V.addEventListener("mouseout", function (e) {
    if (!e.target.closest(".om-chip[data-t]")) return;
    L.classList.remove("dim");
    L.querySelectorAll("line.on").forEach(function (n) { n.classList.remove("on"); });
    V.querySelectorAll(".rel").forEach(function (n) { n.classList.remove("rel"); });
  });

  // drag a spreadsheet row to another project (edit mode, by the \u22ee\u22ee handle)
  V.addEventListener("mousedown", function (e) { var g = e.target.closest(".om-grip"); if (g && edit) g.closest(".om-row").draggable = true; });
  V.addEventListener("dragstart", function (e) { var f = e.target.closest && e.target.closest(".om-row"); if (!f) return; dragId = f.dataset.f; e.dataTransfer.setData("text/plain", dragId); });
  V.addEventListener("dragend", function () { V.querySelectorAll(".om-row[draggable=true]").forEach(function (f) { f.draggable = false; }); });
  V.addEventListener("dragover", function (e) { if (dragId) e.preventDefault(); });
  V.addEventListener("drop", function (e) {
    var pr = e.target.closest(".om-card");
    if (!pr || !dragId) return;
    e.preventDefault();
    var to = find("p", pr.dataset.p), mv = null;
    S.projects.forEach(function (p) {
      for (var i = 0; i < p.files.length; i++) if (p.files[i].id === dragId) { mv = p.files.splice(i, 1)[0]; break; }
    });
    if (mv) to.files.push(mv);
    dragId = null; done();
  });

  var dlg = $("om-dlg");
  $("om-data").onclick = function () { $("om-json").value = JSON.stringify(S, null, 1); $("om-msg").textContent = ""; dlg.showModal(); };
  $("om-close").onclick = function () { dlg.close(); };
  $("om-load").onclick = function () {
    try {
      var v = JSON.parse($("om-json").value);
      if (!v || !Array.isArray(v.projects) || !Array.isArray(v.links)) throw 0;
      S = v; done(); dlg.close();
    } catch (x) { $("om-msg").textContent = "That text is not a saved layout. Copy the whole block, including the first and last brace."; }
  };

  window.addEventListener("resize", draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  // Called by switchMasterTab('omnis') once the panel is visible.
  window.renderOmnis = render;
  render();
})();
