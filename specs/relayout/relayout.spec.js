const TIMEOUT = 30000;

// Informma (CER-2976): laying the pages out again from a changed stretch (Chunker.relayout). Each edit (edits.js)
// is made two ways: to chunker.source after a full layout, then re-laid out; and, for the reference, to the parsed
// content before any page is laid out (?edit=<name>), then laid out in full. The two must give the same pages,
// compared as the clone's page layer compares them: every page's markup, with data-ref values and Paged.js's UUIDs
// renamed by first appearance; and the same contents numbers.

/**
 * Pages as the clone's page layer compares them: data-ref values renamed r1, r2... by first appearance, wherever
 * they're an attribute's value; then every UUID inside a tag renamed u1, u2... (render_equivalence.py).
 * @param {Array<string>} pages each page's outerHTML
 * @returns {Array<string>} the pages, normalised
 */
function normalise(pages) {
	const refs = new Map();
	for (const page of pages) {
		for (const m of page.matchAll(/\sdata-ref="([^"]+)"/g)) {
			if (!refs.has(m[1])) {
				refs.set(m[1], "r" + (refs.size + 1));
			}
		}
	}
	const inTags = (html, f) => html.replace(/<[^>]*>/g, f);
	const uuids = new Map();
	return pages
		.map((page) => inTags(page, (tag) => tag.replace(/(\s[\w:.-]+=")([^"]*)(")/g, (m, a, v, b) => a + (refs.get(v) || v) + b)))
		.map((page) => inTags(page, (tag) => tag.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => {
			if (!uuids.has(u)) {
				uuids.set(u, "u" + (uuids.size + 1));
			}
			return uuids.get(u);
		})));
}

/**
 * What the specs compare, read in the page: every page's markup, each contents link's number (by its counter rule)
 * and its target's page, the counter rules' count and the pages area's page count.
 * @returns {object} the observation
 */
const observe = () => {
	const rules = new Map();
	let counterRules = 0;
	for (const sheet of Array.from(document.styleSheets)) {
		for (const rule of Array.from(sheet.cssRules)) {
			const m = /^\[data-(target-counter-[^=]+)="([^"]+)"\]/.exec(rule.selectorText || "");
			if (m && /counter-reset/.test(rule.cssText)) {
				counterRules++;
				rules.set(m[2], parseInt(/(-?\d+)\s*;\s*\}\s*$/.exec(rule.cssText)[1]));
			}
		}
	}
	const area = document.querySelector(".pagedjs_pages");
	const numbers = Array.from(area.querySelectorAll(".toc a")).map((a) => {
		const attr = Array.from(a.attributes).find((x) => x.name.indexOf("data-target-counter-") === 0);
		const target = area.querySelector(a.getAttribute("href"));
		return { n: attr ? rules.get(attr.value) : null, page: target ? parseInt(target.closest(".pagedjs_page").dataset.pageNumber) : null };
	});
	return {
		pages: Array.from(area.querySelectorAll(".pagedjs_page")).map((p) => p.outerHTML),
		numbers,
		counterRules,
		count: area.style.getPropertyValue("--pagedjs-page-count")
	};
};

/**
 * The page's code that marks each page, makes the edit to chunker.source and lays the pages out again. A string,
 * since page.evaluate is given asynchronous code as written: Babel's rewriting of an async function needs helpers
 * the page doesn't have.
 * @param {string} name the edit
 * @param {object} options the re-layout's options
 * @returns {string} code whose promise gives the result, and each page's place before (null for one laid out again)
 */
const relayout = (name, options = {}) => `(async () => {
	const chunker = window.PagedPolyfill.chunker;
	chunker.pages.forEach((p, i) => { p.element.__was = i; });
	const before = chunker.pages.length;
	const nodes = window.RelayoutEdits[${JSON.stringify(name)}](chunker.source);
	const result = await window.PagedPolyfill.relayout(nodes, ${JSON.stringify(options)});
	const was = Array.from(document.querySelectorAll(".pagedjs_page")).map((el) => el.__was === undefined ? null : el.__was);
	return { result: JSON.parse(JSON.stringify(result)), was, before };
})()`;

/**
 * The page's code that asks for a re-layout of the given text nodes and gives its result as plain data.
 * @param {string} nodes an expression for the nodes, in the page
 * @returns {string} the code
 */
const relayoutOf = (nodes) => `(async () => JSON.parse(JSON.stringify(await window.PagedPolyfill.relayout(${nodes}))))()`;

const EDITS = ["sentence", "grow", "shrink", "two", "contents", "title", "last"];
const KEEP_MOVED = ["grow", "shrink"];

describe("relayout strings", () => {
	let plain;

	beforeAll(async () => {
		const page = await loadPage("relayout/relayout.html");
		await page.rendered;
		plain = await page.evaluate(() => ({
			strings: window.PagedPolyfill.chunker.pages.map((p) => p.carriedStrings ? p.carriedStrings.title : undefined),
			pages: window.PagedPolyfill.chunker.pages.length
		}));
		await page.close();
	}, TIMEOUT);

	it("TL18: keeps the strings carried out of every page", async () => {
		expect(plain.strings.length).toBe(plain.pages);
		expect(plain.strings.every((s) => s === "The Relayout Fixture")).toBe(true);
	});
});

describe("relayout", () => {
	const runs = {};
	const kept = {};
	const references = {};

	beforeAll(async () => {
		let page;
		for (const name of EDITS) {
			page = await loadPage("relayout/relayout.html");
			await page.rendered;
			const run = await page.evaluate(relayout(name));
			runs[name] = Object.assign(run, await page.evaluate(observe));
			await page.close();
			if (KEEP_MOVED.includes(name)) {
				page = await loadPage("relayout/relayout.html");
				await page.rendered;
				const keptRun = await page.evaluate(relayout(name, { keepMoved: true }));
				kept[name] = Object.assign(keptRun, await page.evaluate(observe));
				await page.close();
			}
			page = await loadPage("relayout/relayout.html?edit=" + name);
			await page.rendered;
			references[name] = await page.evaluate(observe);
			await page.close();
		}
	}, TIMEOUT * 5);

	const same = (name, run = runs[name]) => {
		expect(run.result.relaid).toBe(true);
		expect(run.pages.length).toBe(references[name].pages.length);
		expect(normalise(run.pages)).toEqual(normalise(references[name].pages));
	};

	it("TL19: lays out one page again for a sentence on a one-page stretch, keeping the rest", async () => {
		const { result, was, before } = runs.sentence;
		expect(result.regions.length).toBe(1);
		expect(result.regions[0]).toEqual(expect.objectContaining({ laid: 1, replaced: 1, shift: 0 }));
		const relaid = result.regions[0].from - 1;
		expect(was.length).toBe(before);
		was.forEach((w, i) => expect([i, w]).toEqual([i, i === relaid ? null : i]));
		same("sentence");
	});

	it("TL20: numbers the pages and gives their count after an edit that adds one", async () => {
		const { result, before } = runs.grow;
		expect(result.regions[0].shift).toBe(1);
		expect(result.pages).toBe(before + 1);
		expect(runs.grow.count).toBe(String(before + 1));
		same("grow");
	});

	it("TL21: numbers the pages after an edit that removes one", async () => {
		expect(runs.shrink.result.regions[0].shift).toBe(-1);
		same("shrink");
	});

	it("TL22: lays out two stretches in one call, front to back", async () => {
		expect(runs.two.result.regions.length).toBe(2);
		expect(runs.two.result.regions[0].from).toBeLessThan(runs.two.result.regions[1].from);
		same("two");
	});

	it("TL23: numbers the contents again", async () => {
		expect(runs.grow.numbers).toEqual(references.grow.numbers);
		expect(runs.grow.numbers.every((x) => x.n === x.page)).toBe(true);
		same("contents");
		expect(runs.contents.numbers).toEqual(references.contents.numbers);
		expect(runs.contents.counterRules).toBe(references.contents.counterRules);
	});

	it("TL24: carries on to the end while the carried strings differ", async () => {
		const { result, before } = runs.title;
		expect(result.regions.length).toBe(1);
		expect(result.regions[0].laid).toBe(before);
		same("title");
	});

	it("TL25: lays the last stretch out to the end", async () => {
		const { result, before } = runs.last;
		expect(result.regions[0].from + result.regions[0].laid - 1).toBe(before + result.regions[0].shift);
		same("last");
	});

	it("TL28: keeps no page that would move: an edit that adds or removes one lays out to the end", async () => {
		for (const name of KEEP_MOVED) {
			const { result, was } = runs[name];
			const region = result.regions[0];
			expect([name, result.renumbered]).toEqual([name, 0]);
			expect([name, region.from + region.laid - 1]).toEqual([name, result.pages]);
			expect(was.slice(region.from - 1).every((w) => w === null)).toBe(true);
		}
	});

	it("TL28: keeps the pages after the next forced break, renumbered, with keepMoved", async () => {
		for (const name of KEEP_MOVED) {
			const { result, was } = kept[name];
			expect([name, result.renumbered > 0]).toEqual([name, true]);
			expect(was.filter((w) => w !== null).length).toBeGreaterThan(result.regions[0].from - 1);
			same(name, kept[name]);
		}
	});
});

describe("relayout refusals", () => {
	const FEATURES = [["footnotes", "footnotes"], ["reset", "page-resets"], ["named", "named-pages"],
		["left", "side-pages"], ["fixed", "fixed"], ["running", "running"], ["side", "side-breaks"]];

	const refuse = async (page, make) => {
		const before = await page.evaluate(() => Array.from(document.querySelectorAll(".pagedjs_page")).map((p) => p.outerHTML));
		const result = await page.evaluate(make);
		const after = await page.evaluate(() => Array.from(document.querySelectorAll(".pagedjs_page")).map((p) => p.outerHTML));
		expect(after).toEqual(before);
		return result;
	};

	const p3 = relayoutOf("[window.PagedPolyfill.chunker.source.querySelector('#p3').firstChild]");

	for (const [feature, reason] of FEATURES) {
		it(`TL26: refuses a document with ${feature}`, async () => {
			const page = await loadPage("relayout/refusals.html?feature=" + feature);
			await page.rendered;
			const result = await refuse(page, p3);
			expect(result).toEqual({ relaid: false, reason });
			if (!DEBUG) {
				await page.close();
			}
		}, TIMEOUT);
	}

	it("TL26: refuses before the layout ends, a node outside the content, and while re-laying out", async () => {
		const page = await loadPage("relayout/refusals.html?feature=early");
		await page.rendered;
		expect(await page.evaluate("window.RefusalEarly.then((r) => JSON.parse(JSON.stringify(r)))"))
			.toEqual({ relaid: false, reason: "not-rendered" });
		expect(await refuse(page, relayoutOf("[document.createTextNode('x')]")))
			.toEqual({ relaid: false, reason: "outside" });
		const both = await page.evaluate(`(async () => {
			const source = window.PagedPolyfill.chunker.source;
			const first = window.PagedPolyfill.relayout([source.querySelector("#p1").firstChild]);
			const second = await window.PagedPolyfill.relayout([source.querySelector("#p4").firstChild]);
			return JSON.parse(JSON.stringify([second, (await first).relaid]));
		})()`);
		expect(both).toEqual([{ relaid: false, reason: "relaying" }, true]);
		if (!DEBUG) {
			await page.close();
		}
	}, TIMEOUT);
});
