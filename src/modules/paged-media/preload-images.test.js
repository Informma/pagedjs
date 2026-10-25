import PreloadImages from "./preload-images.js";

/**
 * Parsed content as Paged.js has it: a template's inert fragment.
 * @param {string} html the content
 * @returns {DocumentFragment} the fragment
 */
function content(html) {
	let template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
}

/**
 * A fragment's markup.
 * @param {DocumentFragment} fragment the fragment
 * @returns {string} its children's markup, in order
 */
function markup(fragment) {
	let box = document.createElement("div");
	box.appendChild(fragment.cloneNode(true));
	return box.innerHTML;
}

/**
 * The images a handler has asked for once the preload has started: at afterParsed, or with the first page laid out.
 * @param {PreloadImages} handler the handler, after afterParsed
 * @returns {Array<string>} their addresses
 */
function started(handler) {
	if (typeof handler.afterPageLayout === "function") {
		handler.afterPageLayout();
	}
	return handler.images.map((image) => image.src);
}

describe("PreloadImages", () => {

	it("TL15: leaves the parsed content as it was", () => {
		let parsed = content("<p>a</p><img src=\"a.png\" alt=\"\"><div class=\"x\"><img src=\"b.png\" width=\"10\"></div>");
		let before = markup(parsed);
		let handler = new PreloadImages();
		handler.afterParsed(parsed);
		started(handler);
		expect(markup(parsed)).toBe(before);
	});

	it("TL16: skips data: and repeats, resolves a relative src, asks for nothing without images, keeps none after the layout", () => {
		let handler = new PreloadImages();
		handler.afterParsed(content("<img src=\"a.png\"><img src=\"data:image/png;base64,AAAA\"><img src=\"a.png\">" +
			"<img src=\"https://images.test/b.png\"><img>"));
		expect(started(handler)).toEqual([new URL("a.png", document.baseURI).href, "https://images.test/b.png"]);
		handler.afterRendered();
		expect(handler.images).toEqual([]);

		let none = new PreloadImages();
		none.afterParsed(content("<p>no images</p>"));
		expect(started(none)).toEqual([]);
	});
});
