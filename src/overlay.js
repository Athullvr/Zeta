// Typography over the picture. It draws the director's cue states into the DOM: nothing here keeps its own clock,
// so a letter's opacity is a pure function of the frame it is given.
(function (root) {
  "use strict";
  const U = typeof module === "object" && module.exports ? require("./util.js") : root.ETERNAL.util;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildTitle(cue) {
    const box = el("div", "cue title"), word = el("div", "title-word");
    const letters = [...cue.text].map(ch => { const s = el("span", "ch", ch); word.appendChild(s); return s; });
    const rule = el("div", "title-rule");
    box.append(word, rule);
    box.setAttribute("aria-label", cue.text);
    return { box, word, rule, letters };
  }

  function buildPoem(cue) {
    const box = el("div", "cue poem");
    const lines = cue.lines.map(text => {
      const line = el("div", "poem-line");
      const words = text.split(" ").map((w, i, a) => { const s = el("span", "wd", w); line.appendChild(s); if (i < a.length - 1) line.appendChild(document.createTextNode(" ")); return s; });
      box.appendChild(line);
      return words;
    });
    box.setAttribute("aria-label", cue.lines.join(" "));
    return { box, words: lines.flat() };
  }

  function createOverlay(container) {
    const parts = new Map();
    const last = new Map();      // last style signature per cue, to skip DOM writes when nothing changed

    function ensure(cue) {
      if (parts.has(cue.id)) return parts.get(cue.id);
      const p = cue.kind === "title" ? buildTitle(cue) : buildPoem(cue);
      p.kind = cue.kind;
      container.appendChild(p.box);
      parts.set(cue.id, p);
      return p;
    }

    function paintTitle(p, c, fade) {
      const n = p.letters.length, out = 1 - U.smooth(c.exit);
      p.letters.forEach((s, i) => {
        const r = U.smoother(U.stagger(c.enter, i, n, .62));
        s.style.opacity = (r * out * (1 - fade)).toFixed(3);
        s.style.filter = `blur(${((1 - r) * 16).toFixed(2)}px)`;
        s.style.transform = `translateY(${((1 - r) * .16).toFixed(3)}em)`;
      });
      p.word.style.setProperty("--ls", (.30 + .16 * U.easeOut(c.enter)).toFixed(4) + "em");
      p.rule.style.transform = `scaleX(${U.easeOut(U.seg(c.enter, .35, 1)).toFixed(3)})`;
      p.rule.style.opacity = (out * (1 - fade)).toFixed(3);
    }

    function paintPoem(p, c, fade) {
      const n = p.words.length, out = U.smooth(c.exit);
      p.words.forEach((s, i) => {
        const r = U.smoother(U.stagger(c.enter, i, n, .78));
        // dissolving: the words drift up and blur away, a little out of step with one another
        const o = U.clamp(c.exit * 1.25 - (i / n) * .25);
        s.style.opacity = (r * (1 - U.smooth(o)) * (1 - fade)).toFixed(3);
        s.style.filter = `blur(${((1 - r) * 8 + U.smooth(o) * 10).toFixed(2)}px)`;
        s.style.transform = `translateY(${((1 - r) * .35 - U.smooth(o) * .5).toFixed(3)}em)`;
      });
      p.box.style.letterSpacing = (.02 + .02 * out).toFixed(4) + "em";
    }

    // fade: 0..1 global fade-to-black, so the words go with the picture
    function update(frame, fade = 0) {
      for (const c of frame.cues) {
        const p = ensure(c);
        const visible = c.visible || c.exit > 0 && c.exit < 1;
        if (p.box.hidden === visible) p.box.hidden = !visible;
        if (!visible) continue;
        const sig = c.enter.toFixed(4) + "|" + c.exit.toFixed(4) + "|" + fade.toFixed(3);
        if (last.get(c.id) === sig) continue;
        last.set(c.id, sig);
        (p.kind === "title" ? paintTitle : paintPoem)(p, c, fade);
      }
    }
    return { update };
  }

  const api = { createOverlay };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).overlay = api;
})(typeof self !== "undefined" ? self : globalThis);
