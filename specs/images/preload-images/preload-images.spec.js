const TIMEOUT = 30000;

// Informma (CER-2976): the content's images are asked for once the first page is laid out, not page by page as each
// page is. The document's first page has no images; pages 2-7 hold two each (img-01.png to img-12.png).
const NAMES = Array.from({length: 12}, (_, i) => `img-${String(i + 1).padStart(2, "0")}.png`);

/**
 * The first two pages' layout times and each image request's start, on the page's clock, in the order requested.
 * @returns {object} what TL14 compares
 */
const observe = () => ({
	started: window.__started,
	laid: window.__laid,
	starts: performance.getEntriesByType("resource")
		.filter((e) => /img-\d+\.png$/.test(e.name))
		.map((e) => [e.name.split("/").pop(), e.startTime])
});

describe("preload-images", () => {
	let page, seen;
	beforeAll(async () => {
		page = await loadPage("images/preload-images/preload.html");
		await page.rendered;
		seen = await page.evaluate(observe);
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	// Started when the first page is laid out (the first afterPageLayout, Paged.js's own handlers before the
	// document's), so no earlier than the first page's layout began, and before the second page is laid out.
	it("TL14: asks for every image once the first page is laid out, before the second, in document order, each once", async () => {
		expect(seen.starts.map(([name]) => name)).toEqual(NAMES);
		for (const [name, start] of seen.starts) {
			expect([name, start > seen.started[0] && start < seen.laid[1]]).toEqual([name, true]);
		}
	});
});
