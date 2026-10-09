// The one script added to every preview page.
//
// The board app lives on another origin, so it cannot read this page's DOM. Instead it sends us
// messages ("what is at x,y?", "list the children of e7") and we answer. Elements are never sent
// across; only small ids like "e7" are. Everything below is plain DOM code.
(() => {
  if (window.parent === window) return; // opened directly, not inside the board

  const pageId = Math.random().toString(36).slice(2); // new for every document, so stale messages are detectable
  const send = (type, data) => parent.postMessage({ src: "agent", pageId, type, ...data }, "*");

  // ---------- element ids ----------
  // The page may throw its DOM nodes away and rebuild them, and the host must not lose or swap the
  // selection when that happens. So an id is built from something that survives a rebuild:
  //   "k:<data-key>"            an element with a unique data-key (or "i:<id>" for a unique id attribute)
  //   "k:<key>/LI.row.2/SPAN..0"  any other element below a data-key element: tag, class and child index of each step
  //   "e12"                     everything else: tied to the node itself; if the node dies, the element is "gone"
  // Looking an id up uses the original node while it is still in the page. Only when that node is
  // gone do we rebuild it from the key and path, and we check every tag on the way. We never guess.
  const byId = new Map();
  const idOfNode = new WeakMap();
  let counter = 0;

  // Something that names this element and survives a rebuild: a unique data-key, or (only for the
  // element itself) a unique id attribute. An id is not trusted as an anchor for the elements below it.
  function stable(el, allowId) {
    const key = el.getAttribute("data-key");
    if (key && document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`).length === 1) return "k:" + encodeURIComponent(key);
    if (allowId && el.id && document.querySelectorAll(`[id="${CSS.escape(el.id)}"]`).length === 1) return "i:" + encodeURIComponent(el.id);
    return null;
  }

  // Each step is tag, class and position, so a path only matches an element that looks the same.
  const step = (n) => [n.tagName, n.getAttribute("class") || "", [...n.parentElement.children].indexOf(n)].map((v) => encodeURIComponent(v).replace(/\./g, "%2E")).join(".");

  function pathId(el) {
    const steps = [];
    for (let n = el; n.parentElement; n = n.parentElement) {
      steps.unshift(step(n));
      const base = stable(n.parentElement, false);
      if (base) return base + "/" + steps.join("/");
    }
    return null;
  }

  function idOf(el) {
    let id = idOfNode.get(el);
    if (id) return id;
    id = stable(el, true) || pathId(el) || "e" + ++counter;
    const other = byId.get(id);
    if (other && other !== el && other.isConnected) id = "e" + ++counter; // that id belongs to a live element
    idOfNode.set(el, id);
    byId.set(id, el);
    return id;
  }

  function find(id) {
    const el = byId.get(id);
    if (el && el.isConnected) return el;
    byId.delete(id);
    if (id[1] !== ":") return null;
    const [head, ...steps] = id.split("/");
    const value = decodeURIComponent(head.slice(2));
    const hits = document.querySelectorAll(head[0] === "k" ? `[data-key="${CSS.escape(value)}"]` : `[id="${CSS.escape(value)}"]`);
    let n = hits.length === 1 ? hits[0] : null;
    for (const s of steps) {
      if (!n) break;
      const [tag, cls, index] = s.split(".").map(decodeURIComponent);
      n = n.children[Number(index)];
      if (n && (n.tagName !== tag || (n.getAttribute("class") || "") !== cls)) n = null;
    }
    if (n && idOfNode.get(n) && idOfNode.get(n) !== id) n = null;
    if (n) { idOfNode.set(n, id); byId.set(id, n); }
    return n;
  }

  // ---------- describing elements ----------
  const isTarget = (el) => el && el !== document.documentElement && el !== document.body;

  function nameOf(el) {
    const dataName = el.getAttribute("data-name");
    if (dataName) return dataName;
    const tag = el.tagName.toLowerCase();
    if (el.classList[0]) return tag + "." + el.classList[0];
    if (el.id) return tag + "#" + el.id;
    return tag;
  }

  const row = (el) => ({ id: idOf(el), name: nameOf(el), key: el.getAttribute("data-key"), has: el.childElementCount > 0 });

  function box(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, name: nameOf(el) };
  }

  function live(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id,
      classes: [...el.classList].join(" "),
      size: `${Math.round(r.width)} × ${Math.round(r.height)}`,
      position: `${Math.round(r.left + scrollX)}, ${Math.round(r.top + scrollY)}`,
      text: (el.textContent || "").trim().slice(0, 120),
      color: cs.color,
      background: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      key: el.getAttribute("data-key") || "",
    };
  }

  // ---------- keeping the host's outlines glued to elements ----------
  // The host tells us which ids it is drawing; every frame we measure them and send changes.
  let tracked = { hover: null, selected: [] };
  let lastSent = "";

  function tick() {
    const ids = new Set(tracked.selected);
    if (tracked.hover) ids.add(tracked.hover);
    if (ids.size) {
      const boxes = {};
      const lives = {};
      for (const id of ids) {
        const el = find(id);
        boxes[id] = el ? box(el) : null; // null = this element no longer exists
        if (el && tracked.selected.includes(id)) lives[id] = live(el);
      }
      const json = JSON.stringify([boxes, lives]);
      if (json !== lastSent) {
        lastSent = json;
        send("tracked", { boxes, lives });
      }
    }
    requestAnimationFrame(tick);
  }

  // The layers panel re-reads the levels it has loaded when the DOM changes.
  let changeTimer;
  new MutationObserver(() => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => send("changed"), 100);
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "data-name", "data-key"] });

  // ---------- scrolling ----------
  function canScroll(el, dx, dy) {
    const s = getComputedStyle(el);
    const y = /auto|scroll/.test(s.overflowY) && ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0));
    const x = /auto|scroll/.test(s.overflowX) && ((dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) || (dx < 0 && el.scrollLeft > 0));
    return y || x;
  }

  // Scroll the page (and only the page) so `el` is visible. We don't use scrollIntoView because it
  // can also scroll the board that contains this iframe.
  const scrolls = (p) => {
    const s = getComputedStyle(p);
    return (/auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight) || (/auto|scroll/.test(s.overflowX) && p.scrollWidth > p.clientWidth);
  };
  function reveal(el) {
    const centreIn = (outer, by) => {
      const r = el.getBoundingClientRect();
      if (r.top >= outer.top && r.bottom <= outer.bottom && r.left >= outer.left && r.right <= outer.right) return;
      by(r.left + r.width / 2 - (outer.left + outer.right) / 2, r.top + r.height / 2 - (outer.top + outer.bottom) / 2);
    };
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (isTarget(p) && scrolls(p)) centreIn(p.getBoundingClientRect(), (dx, dy) => p.scrollBy(dx, dy));
    }
    centreIn({ top: 0, left: 0, bottom: innerHeight, right: innerWidth }, (dx, dy) => scrollBy(dx, dy));
  }

  // ---------- search: the whole tree, loaded in the panel or not ----------
  function search(query) {
    const q = query.toLowerCase();
    const out = [];
    const walk = (parent, depth) => {
      let any = false;
      for (const el of parent.children) {
        const at = out.length;
        out.push({ ...row(el), depth });
        const inner = walk(el, depth + 1);
        if (inner || nameOf(el).toLowerCase().includes(q)) any = true;
        else out.length = at;
      }
      return any;
    };
    walk(document.body, 0);
    return out;
  }

  // ---------- messages from the host ----------
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.src !== "host" || m.pageId !== pageId) return;
    const reply = (data) => send("reply", { rid: m.rid, data });
    try {
      switch (m.type) {
        case "track":
          tracked = { hover: m.hover, selected: m.selected };
          lastSent = "";
          break;
        case "hit": {
          const el = document.elementFromPoint(m.x, m.y);
          if (!isTarget(el)) return reply(null); // nothing, or the page background
          const chain = [];
          for (let n = el; isTarget(n); n = n.parentElement) chain.unshift(idOf(n));
          reply({ id: idOf(el), chain, box: box(el) });
          break;
        }
        case "children": {
          const parentEl = m.parent ? find(m.parent) : document.body;
          reply(parentEl ? [...parentEl.children].map(row) : null);
          break;
        }
        case "path": {
          // every level from the top down to this element, so the panel needs one request, not one per level
          const el = find(m.id);
          if (!el) return reply(null);
          const levels = [];
          for (let n = el; isTarget(n); n = n.parentElement) {
            const p = n.parentElement;
            levels.push({ parent: isTarget(p) ? idOf(p) : null, kids: [...p.children].map(row) });
          }
          reply(levels);
          break;
        }
        case "nav": {
          const el = find(m.id);
          if (!el) return reply(null);
          let target = null;
          if (m.op === "child") target = el.firstElementChild;
          else if (m.op === "parent") target = isTarget(el.parentElement) ? el.parentElement : null;
          else {
            const sibs = [...el.parentElement.children];
            target = sibs[(sibs.indexOf(el) + (m.op === "next" ? 1 : -1) + sibs.length) % sibs.length];
          }
          reply(target ? idOf(target) : null);
          break;
        }
        case "search":
          reply(search(m.q));
          break;
        case "scrollTo": {
          const el = find(m.id);
          if (el) reveal(el);
          break;
        }
        case "wheel": {
          // the host's click-catcher covers the page in Select mode, so it sends us the wheel
          let el = document.elementFromPoint(m.x, m.y);
          while (el && !(isTarget(el) && canScroll(el, m.dx, m.dy))) el = el.parentElement;
          (el || window).scrollBy(m.dx, m.dy);
          break;
        }
        case "devThrow":
          setTimeout(() => { throw new Error("Dev: simulated error inside the page"); });
          break;
      }
    } catch (err) {
      if (m.rid) send("reply", { rid: m.rid, error: String((err && err.message) || err) });
    }
  });

  // ---------- things the page does that the host cares about ----------
  // Ctrl/Cmd + wheel over an interactive page would otherwise zoom the browser, not the board.
  addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    send("zoom", { x: e.clientX, y: e.clientY, dy: e.deltaY });
  }, { passive: false });

  // Shortcuts must work right after the user clicked inside an interactive page.
  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    if (["v", "V", "i", "I", "Escape"].includes(e.key)) send("key", { key: e.key });
  });

  addEventListener("error", (e) => send("pageError", { message: e.message || String(e.error) }));
  addEventListener("unhandledrejection", (e) => send("pageError", { message: String((e.reason && e.reason.message) || e.reason) }));
  addEventListener("pagehide", () => send("bye"));

  send("hello");
  requestAnimationFrame(tick);
})();
