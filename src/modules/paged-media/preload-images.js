import Handler from "../handler.js";

/**
 * Starts every image of the parsed content loading once the first page is laid out (Informma, CER-2976).
 *
 * The content Paged.js lays out is inert until a page holds it: a template that builds its content in beforeParsed
 * puts its images where they don't load, and each then loads only when its page is laid out, while Layout waits for
 * it (waitForImages). So a document's images download one page at a time, on the layout's path. Here each distinct
 * image is asked for once, in document order, the order the pages are laid out in, so that by the time a page holds
 * it, it has arrived or is on its way; Layout's own wait is unchanged. They're asked for when the first page has
 * been laid out, not at parse, so they don't compete with the first page's own loads (its fonts, its images). The
 * content isn't touched: only its images' src is read. Nothing is kept once the layout ends.
 */
class PreloadImages extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.images = [];
		this.parsed = undefined;
	}

	afterParsed(parsed) {
		this.parsed = parsed;
	}

	afterPageLayout() {
		if (this.parsed) {
			this.images = imagesOf(this.parsed);
			this.parsed = undefined;
		}
	}

	afterRendered() {
		this.images = [];
		this.parsed = undefined;
	}
}

/**
 * An Image for every distinct src of the content's img elements, in document order, data: URIs left out.
 * @param {DocumentFragment|Element} parsed the parsed content
 * @returns {Array<HTMLImageElement>} the images asked for
 */
export function imagesOf(parsed) {
	let seen = new Set();
	let images = [];
	if (!parsed || !parsed.querySelectorAll) {
		return images;
	}
	for (let img of parsed.querySelectorAll("img[src]")) {
		let src = img.getAttribute("src");
		if (!src || src.startsWith("data:") || seen.has(src)) {
			continue;
		}
		seen.add(src);
		let image = new Image();
		image.src = new URL(src, document.baseURI).href;
		images.push(image);
	}
	return images;
}

export default PreloadImages;
