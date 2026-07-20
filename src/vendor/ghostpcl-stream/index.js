//#region src/index.js
var e = new URL(
	/* @vite-ignore */
	"./gpcl-stream.js",
	import.meta.url
), t = new URL(
	/* @vite-ignore */
	"./gpcl-stream.wasm",
	import.meta.url
), n = new URL(
	/* @vite-ignore */
	"./fonts-dj500-min/",
	import.meta.url
), r = [
	"ArtLinePrinter.ttf",
	"NimbusMono-Bold.ttf",
	"NimbusMono-BoldItalic.ttf",
	"NimbusMono-Italic.ttf",
	"NimbusMono-Regular.ttf"
], i = /^\/work\/thumb-\d{6}\.png$/;
function a(e) {
	return e.protocol === "file:" ? decodeURIComponent(e.pathname) : e.href;
}
async function o(e) {
	if (e.protocol === "file:") {
		let { readFile: t } = await import(
			/* @vite-ignore */
			"node:fs/promises"
);
		return new Uint8Array(await t(e));
	}
	let t = await fetch(e);
	if (!t.ok) throw Error(`Failed to fetch ${e.href}: HTTP ${t.status}`);
	return new Uint8Array(await t.arrayBuffer());
}
function s(e, t) {
	let n = "";
	for (let r of t.split("/").filter(Boolean)) n += `/${r}`, e.FS.analyzePath(n).exists || e.FS.mkdir(n);
}
async function c(e) {
	s(e, "/windows/fonts"), await Promise.all(r.map(async (t) => {
		let r = await o(new URL(t, n));
		e.FS.writeFile(`/windows/fonts/${t}`, r);
	}));
}
function l(e) {
	return i.test(e);
}
var u = class {
	#e;
	#t = null;
	#n = 0;
	#r = [];
	#i = !1;
	#a = !1;
	constructor(e) {
		if (!e || typeof e.thumbnail_ppi != "number") throw TypeError("thumbnail_ppi is required");
		if (typeof e.on_page_eject != "function") throw TypeError("on_page_eject is required");
		this.#e = e;
	}
	async start() {
		if (this.#i) throw Error("GhostPclStream has already started");
		let { default: n } = await import(
			/* @vite-ignore */
			e.href
), r = await n({
			locateFile(e, n) {
				return e.endsWith(".wasm") ? a(t) : `${n}${e}`;
			},
			noInitialRun: !0,
			print() {},
			printErr() {}
		});
		if (this.#t = r, await c(r), s(r, "/work"), this.#o(), this.#s(), this.#n = r._gpcl_stream_create(this.#e.thumbnail_ppi | 0), !this.#n) throw Error("gpcl_stream_create failed");
		this.#i = !0;
	}
	push(e) {
		if (!this.#i || this.#a || !this.#t || !this.#n) throw Error("GhostPclStream is not running");
		this.#t._gpcl_stream_push(this.#n, e | 0), this.#c();
	}
	async stop() {
		if (!this.#i || this.#a || !this.#t || !this.#n) throw Error("GhostPclStream is not running");
		let e = this.#t;
		return e._gpcl_stream_destroy(this.#n), this.#n = 0, this.#a = !0, this.#c(), new Uint8Array(e.FS.readFile("/work/file.pdf"));
	}
	#o() {
		for (let e of this.#t.FS.readdir("/work")) e === "." || e === ".." || this.#t.FS.unlink(`/work/${e}`);
	}
	#s() {
		let e = this.#t, t = e.FS.open.bind(e.FS), n = e.FS.close.bind(e.FS), r = /* @__PURE__ */ new WeakMap();
		e.FS.open = (...e) => {
			let n = t(...e);
			return typeof e[0] == "string" && r.set(n, e[0]), n;
		};
		let i = (t) => {
			let a = r.get(t) || t?.path || "", o = n(t);
			if (l(a)) {
				e.FS.close = n;
				try {
					this.#r.push(new Uint8Array(e.FS.readFile(a)));
				} finally {
					e.FS.close = i;
				}
			}
			return o;
		};
		e.FS.close = i;
	}
	#c() {
		for (; this.#r.length > 0;) this.#e.on_page_eject(this.#r.shift());
	}
};
//#endregion
export { u as GhostPclStream };

//# sourceMappingURL=index.js.map