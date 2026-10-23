const TIMEOUT = 30000;

// Informma's characterisation of the page numbers in margin boxes (CER-2976): what 0.4.3 itself writes and draws
// for the catalogue's margin boxes, a page number alone, a first page without them, left and right margins, a blank
// page, a named page, a contents list and three images (numbers.html); and for what a hold of the page counters must
// refuse (fallback.html). held-page-numbers.expected.json was written from 0.4.3's own run (informma.1, cb5a546), so
// a later change can't move a page's text, width or number unseen. Every test here holds on it and must keep holding.
const EXPECTED = require("./held-page-numbers.expected.json");

/**
 * Each page's inline style, and its margin boxes' and groups' (finalizePage writes their widths there), in order;
 * the content area's column width; and the counter rules of Paged.js's and the document's sheets.
 * @returns {object} what TL1, TL3 and TL4 compare
 */
const observe = () => {
	const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
	const styled = (page) => Array.from(page.querySelectorAll(".pagedjs_pagebox [style]"))
		.filter((el) => !el.closest(".pagedjs_area"))
		.map((el) => [Array.from(el.classList).filter((c) => c.indexOf("pagedjs_") === 0).join(" "), el.getAttribute("style")]);
	const rules = [];
	const walk = (list) => {
		for (const rule of Array.from(list)) {
			if (rule.cssRules && !rule.selectorText) {
				walk(rule.cssRules);
			} else if (rule.cssText && rule.cssText.indexOf("counter") >= 0 && rule.cssText.indexOf("target-counter") < 0) {
				rules.push(rule.cssText);
			}
		}
	};
	for (const sheet of Array.from(document.styleSheets)) {
		walk(sheet.cssRules);
	}
	return {
		pages: pages.length,
		pageStyles: pages.map((p) => p.getAttribute("style")),
		margins: pages.map(styled),
		columnWidths: pages.map((p) => p.querySelector(".pagedjs_page_content").style.columnWidth),
		rules
	};
};

/** The pages TL2 and TL4 compare as PDF snapshots. */
const FIRST_PAGE = 1;
const CONTENTS_PAGE = 2;
const LEFT_PAGE = 4;
const NAMED_PAGE = 13;
const BODY_NUMBER_PAGE = 2;
const RESET_PAGE = 4;

describe("held-page-numbers", () => {
	let page, seen;
	beforeAll(async () => {
		page = await loadPage("page-numbers/held-page-numbers/numbers.html");
		await page.rendered;
		seen = await page.evaluate(observe);
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	// finalizePage measures the margin boxes' text while the pages are laid out, and writes the widths it finds
	// into each margin group's grid-template-columns: so these see the text drawn then, as well as after.
	it("TL1: writes every page's and margin box's inline style as 0.4.3 does", async () => {
		expect(seen.pageStyles).toEqual(EXPECTED.numbers.pageStyles);
		expect(seen.margins).toEqual(EXPECTED.numbers.margins);
	});

	if (!DEBUG) {
		it("TL2: draws the page numbers as 0.4.3 does", async () => {
			const pdf = await page.pdf(PDF_SETTINGS);
			expect(pdf).toMatchPDFSnapshot(FIRST_PAGE);
			expect(pdf).toMatchPDFSnapshot(CONTENTS_PAGE);
			expect(pdf).toMatchPDFSnapshot(LEFT_PAGE);
			expect(pdf).toMatchPDFSnapshot(NAMED_PAGE);
		});
	}

	// 0.4.3 measures each new page's content area before the page has a class: the same size on every page.
	it("TL3: lays out the pages, each content area as wide as 0.4.3 makes it", async () => {
		expect(seen.pages).toEqual(EXPECTED.numbers.pages);
		expect(seen.columnWidths).toEqual(EXPECTED.numbers.columnWidths);
	});

	// 0.4.3 walks the pages laid out so far, reading each one's computed style, as each link's target appears: 20
	// reads here, all before the last page exists.
	it("TL5: reads no page's counter styles until the last page exists", async () => {
		const counts = await page.evaluate(() => window.__counts);
		expect(counts.pageStyles.length).toBeGreaterThan(0);
		expect(counts.pageStyles.filter((pages) => pages < EXPECTED.numbers.pages)).toEqual([]);
	});

	// Each rule inserted costs a style recalculation, paid by the next style read: every page's counter styles are
	// read for the numbers before the first rule goes in, so the reads pay for none of them.
	it("TL11: reads every page's counter styles before it inserts the first number's rule", async () => {
		const counts = await page.evaluate(() => window.__counts);
		expect(counts.order).toMatch(/^s+r+$/);
	});

	// 0.4.3 keeps the page counter in force on every page as it's laid out, and the margin boxes' numbers drawn from
	// it: Chrome then brings every counter in the document up to date as each page is inserted, at a cost that grows
	// with the pages before it.
	it("TL6: holds the page counters while the pages are laid out", async () => {
		const samples = await page.evaluate(() => window.__samples);
		expect(Object.keys(samples.increments)).toEqual(["none"]);
		expect(samples.contents.counter).toBeUndefined();
		expect(samples.contents.other).toBeGreaterThan(0);
	});

	it("TL7: leaves the counters' rules and the pages as 0.4.3 has them when the layout ends", async () => {
		expect(seen.rules).toEqual(EXPECTED.numbers.rules);
		expect(seen.pageStyles.filter((style) => style.indexOf("--pagedjs-held-page") >= 0)).toEqual([]);
	});
});

describe("held-page-numbers fallback", () => {
	let page, seen;
	beforeAll(async () => {
		page = await loadPage("page-numbers/held-page-numbers/fallback.html");
		await page.rendered;
		seen = await page.evaluate(observe);
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("TL4: lays out, writes and draws a counter style, a page number in the body and a page reset as 0.4.3 does", async () => {
		expect(seen.pages).toEqual(EXPECTED.fallback.pages);
		expect(seen.pageStyles).toEqual(EXPECTED.fallback.pageStyles);
		expect(seen.margins).toEqual(EXPECTED.fallback.margins);
		expect(seen.columnWidths).toEqual(EXPECTED.fallback.columnWidths);
		if (!DEBUG) {
			const pdf = await page.pdf(PDF_SETTINGS);
			expect(pdf).toMatchPDFSnapshot(BODY_NUMBER_PAGE);
			expect(pdf).toMatchPDFSnapshot(RESET_PAGE);
		}
	});

	it("TL8: doesn't hold the page counters of a document it can't hold exactly", async () => {
		const samples = await page.evaluate(() => window.__samples);
		expect(Object.keys(samples.increments).filter((increment) => increment !== "none").length).toBeGreaterThan(0);
		expect(samples.contents.counter).toBeGreaterThan(0);
		expect(seen.rules).toEqual(EXPECTED.fallback.rules);
	});
});
