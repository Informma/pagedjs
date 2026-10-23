const TIMEOUT = 30000;

// Informma's characterisation of target-counter() (CER-2976): what 0.4.3 itself does with a contents list of forward,
// backward, same-page, duplicate, missing, dotted, split, blank-page and counter-reset targets. The expectations
// below were written from 0.4.3's own run of this document, so a later change can't move a number unseen.
// Every test here holds on 0.4.3 and must keep holding.

/** Each link's number, as the counter-reset the handler set on its ::after, in document order. */
const NUMBERS = [
	["#s1", 2],
	["#s2", 3],
	["#s3", 4],
	["#s3", 4],
	["#chap.dot", 6],
	["#s5", 7],
	["#split-target", 9],
	["#s7", 11],
	["#s8", 20],
	["#s9", 21],
	["#s12", 24],
	["#s16", 28],
	["#nowhere", null],
	["#s17", 29],
	["#s5-note", 7],
	["#s1", 2],
	["#s8", 20]
];

/** The page count, and the redraw's mark: style="" on each link 0.4.3 redraws, none on the others. */
const PAGES = 21;
const STYLES = [
	["#s1", ""],
	["#s2", ""],
	["#s3", ""],
	["#s3", ""],
	["#chap.dot", ""],
	["#s5", ""],
	["#split-target", ""],
	["#s7", ""],
	["#s8", ""],
	["#s9", ""],
	["#s12", ""],
	["#s16", ""],
	["#nowhere", null],
	["#s17", ""],
	["#s5-note", ""],
	["#s1", ""],
	["#s8", ""]
];

/** The pages TN2 compares as PDF snapshots: the contents page and the page with the backward links. */
const CONTENTS_PAGE = 1;
const BACKWARD_PAGE = 21;

describe("target-counter-numbers", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("target/target-counter-numbers/target-counter-numbers.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	const links = () => page.$$eval("nav a, a.see", (elements) => elements.map((a) => {
		const m = /(-?\d+)\s*$/.exec(getComputedStyle(a, "::after").counterReset || "");
		return {href: a.getAttribute("href"), number: m ? +m[1] : null, style: a.getAttribute("style")};
	}));

	it("TN1: numbers every link as 0.4.3 does", async () => {
		expect((await links()).map((l) => [l.href, l.number])).toEqual(NUMBERS);
	});

	if (!DEBUG) {
		it("TN2: draws the numbers as 0.4.3 does", async () => {
			const pdf = await page.pdf(PDF_SETTINGS);
			expect(pdf).toMatchPDFSnapshot(CONTENTS_PAGE);
			expect(pdf).toMatchPDFSnapshot(BACKWARD_PAGE);
		});
	}

	it("TN3: lays out the pages, and marks the links it redraws, as 0.4.3 does", async () => {
		const pages = await page.$$eval(".pagedjs_page", (p) => p.length);
		expect(pages).toEqual(PAGES);
		expect((await links()).map((l) => [l.href, l.style])).toEqual(STYLES);
	});

	// 0.4.3 walks every page laid out so far, reading its computed style, for every link it numbers: 149 reads here.
	it("TN4: reads each page's counter styles at most once", async () => {
		const counts = await page.evaluate(() => window.__counts);
		expect(counts.pageStyles).toBeLessThanOrEqual(PAGES);
	});

	// 0.4.3 looks a link's target up in the whole pages area after every page until it's laid out: 152 lookups here.
	it("TN5: searches the whole pages area at most once for each link", async () => {
		const counts = await page.evaluate(() => window.__counts);
		expect(counts.areaLookups).toBeLessThanOrEqual(NUMBERS.length);
	});
});
