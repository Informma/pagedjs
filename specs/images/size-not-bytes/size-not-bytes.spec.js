/* global browser, ORIGIN */
const TIMEOUT = 60000;

// Informma (CER-2976): a page needs an image's size, not its bytes. On a slow connection the page holding the image
// is laid out once the image's size is known, before it has finished loading; the preview ends only when it has.
// The page starts Paged.js by hand (PagedConfig.auto false), so the connection is slowed before the image is asked
// for and not while the polyfill loads.
describe("size-not-bytes", () => {
	let page, seen;
	beforeAll(async () => {
		page = await browser.newPage();
		await page.goto(ORIGIN + "/specs/images/size-not-bytes/size.html", {waitUntil: "load"});
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Network.enable");
		await cdp.send("Network.emulateNetworkConditions",
			{offline: false, latency: 40, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024});
		await page.evaluate(() => window.PagedPolyfill.preview());
		await page.waitForFunction(() => window.__previewed !== undefined, null, {timeout: TIMEOUT - 5000});
		seen = await page.evaluate(() => ({laid: window.__laid, loaded: window.__imageLoaded, previewed: window.__previewed}));
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("TL17: lays out the page holding the image before the image has loaded, and ends the preview after", async () => {
		expect(seen.laid.length).toBe(3);
		expect(seen.laid[1]).toBeLessThan(seen.loaded);
		expect(seen.previewed).toBeGreaterThan(seen.loaded);
	});
});
