import Page from "./page.js";
import ContentParser from "./parser.js";
import EventEmitter from "event-emitter";
import Hook from "../utils/hook.js";
import Queue from "../utils/queue.js";
import {
	requestIdleCallback
} from "../utils/utils.js";
import { OverflowContentError } from "./renderresult.js";
import { forcedStart, inDocumentOrder, stretchLength } from "./relayout.js";

const MAX_PAGES = false;
const MAX_LAYOUTS = false;

const TEMPLATE = `
<div class="pagedjs_page">
	<div class="pagedjs_sheet">
		<div class="pagedjs_bleed pagedjs_bleed-top">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>
			<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-bottom">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>		<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-left">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>		<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-right">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>
			<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_pagebox">
			<div class="pagedjs_margin-top-left-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-top-left-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-top">
				<div class="pagedjs_margin pagedjs_margin-top-left"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-top-center"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-top-right"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-top-right-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-top-right-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-right">
				<div class="pagedjs_margin pagedjs_margin-right-top"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-right-middle"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-right-bottom"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-left">
				<div class="pagedjs_margin pagedjs_margin-left-top"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-left-middle"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-left-bottom"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom-left-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-bottom-left-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom">
				<div class="pagedjs_margin pagedjs_margin-bottom-left"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-bottom-center"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-bottom-right"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom-right-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-bottom-right-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_area">
				<div class="pagedjs_page_content"></div>
				<div class="pagedjs_footnote_area">
					<div class="pagedjs_footnote_content pagedjs_footnote_empty">
						<div class="pagedjs_footnote_inner_content"></div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>`;

/**
 * Chop up text into flows
 * @class
 */
class Chunker {
	constructor(content, renderTo, options) {
		// this.preview = preview;

		this.settings = options || {};

		this.hooks = {};
		this.hooks.beforeParsed = new Hook(this);
		this.hooks.filter = new Hook(this);
		this.hooks.afterParsed = new Hook(this);
		this.hooks.beforePageLayout = new Hook(this);
		this.hooks.onPageLayout = new Hook(this);
		this.hooks.layout = new Hook(this);
		this.hooks.renderNode = new Hook(this);
		this.hooks.layoutNode = new Hook(this);
		this.hooks.onOverflow = new Hook(this);
		this.hooks.afterOverflowRemoved = new Hook(this);
		this.hooks.onBreakToken = new Hook();
		this.hooks.beforeRenderResult = new Hook(this);
		this.hooks.afterPageLayout = new Hook(this);
		this.hooks.finalizePage = new Hook(this);
		this.hooks.afterRendered = new Hook(this);
		// A re-layout from a changed stretch (Informma, CER-2976): handlers put their state back as it was after the
		// page before the stretch, and say whether it's again what the old layout carried out of a stretch's end
		this.hooks.relayoutFrom = new Hook(this);
		this.hooks.relayoutConverges = new Hook(this);
		// Before a re-layout, each handler may give a reason it can't carry its state through one; after it, each brings
		// its state up to date
		this.hooks.beforeRelayout = new Hook(this);
		this.hooks.afterRelayout = new Hook(this);

		this.pages = [];
		this.total = 0;

		// The first page's content-area size in this layout: every page's, as Page.create measures it (see there)
		this.pageSize = undefined;

		this.q = new Queue(this);
		this.stopped = false;
		this.rendered = false;

		this.content = content;

		this.charsPerBreak = [];
		this.maxChars;

		if (content) {
			this.flow(content, renderTo);
		}
	}

	setup(renderTo) {
		this.pagesArea = document.createElement("div");
		this.pagesArea.classList.add("pagedjs_pages");

		if (renderTo) {
			renderTo.appendChild(this.pagesArea);
		} else {
			document.querySelector("body").appendChild(this.pagesArea);
		}

		this.pageTemplate = document.createElement("template");
		this.pageTemplate.innerHTML = TEMPLATE;

	}

	async flow(content, renderTo) {
		let parsed;

		await this.hooks.beforeParsed.trigger(content, this);

		parsed = new ContentParser(content);

		this.hooks.filter.triggerSync(parsed);

		this.source = parsed;
		this.breakToken = undefined;

		if (this.pagesArea && this.pageTemplate) {
			this.q.clear();
			this.removePages();
		} else {
			this.setup(renderTo);
		}

		this.pageSize = undefined;

		this.emit("rendering", parsed);

		await this.hooks.afterParsed.trigger(parsed, this);

		await this.loadFonts();

		let rendered = await this.render(parsed, this.breakToken);
		while (rendered.canceled) {
			this.start();
			rendered = await this.render(parsed, this.breakToken);
		}

		this.rendered = true;
		this.pagesArea.style.setProperty("--pagedjs-page-count", this.total);

		await this.hooks.afterRendered.trigger(this.pages, this);

		this.emit("rendered", this.pages);



		return this;
	}

	// oversetPages() {
	// 	let overset = [];
	// 	for (let i = 0; i < this.pages.length; i++) {
	// 		let page = this.pages[i];
	// 		if (page.overset) {
	// 			overset.push(page);
	// 			// page.overset = false;
	// 		}
	// 	}
	// 	return overset;
	// }
	//
	// async handleOverset(parsed) {
	// 	let overset = this.oversetPages();
	// 	if (overset.length) {
	// 		console.log("overset", overset);
	// 		let index = this.pages.indexOf(overset[0]) + 1;
	// 		console.log("INDEX", index);
	//
	// 		// Remove pages
	// 		// this.removePages(index);
	//
	// 		// await this.render(parsed, overset[0].overset);
	//
	// 		// return this.handleOverset(parsed);
	// 	}
	// }

	async render(parsed, startAt) {
		let renderer = this.layout(parsed, startAt);

		let done = false;
		let result;

		let loops = 0;
		while (!done) {
			result = await this.q.enqueue(() => { return this.renderAsync(renderer); });
			done = result.done;
			if(MAX_LAYOUTS) {
				loops += 1;
				if (loops >= MAX_LAYOUTS) {
					this.stop();
					break;
				}
			}
		}

		return result;
	}

	start() {
		this.rendered = false;
		this.stopped = false;
	}

	stop() {
		this.stopped = true;
		// this.q.clear();
	}

	renderOnIdle(renderer) {
		return new Promise(resolve => {
			requestIdleCallback(async () => {
				if (this.stopped) {
					return resolve({ done: true, canceled: true });
				}
				let result = await renderer.next();
				if (this.stopped) {
					resolve({ done: true, canceled: true });
				} else {
					resolve(result);
				}
			});
		});
	}

	async renderAsync(renderer) {
		if (this.stopped) {
			return { done: true, canceled: true };
		}
		let result = await renderer.next();
		if (this.stopped) {
			return { done: true, canceled: true };
		} else {
			return result;
		}
	}

	async handleBreaks(node, force) {
		let currentPage = this.total + 1;
		let currentPosition = currentPage % 2 === 0 ? "left" : "right";
		// TODO: Recto and Verso should reverse for rtl languages
		let currentSide = currentPage % 2 === 0 ? "verso" : "recto";
		let previousBreakAfter;
		let breakBefore;
		let page;

		if (currentPage === 1) {
			return;
		}

		if (node &&
				typeof node.dataset !== "undefined" &&
				typeof node.dataset.previousBreakAfter !== "undefined") {
			previousBreakAfter = node.dataset.previousBreakAfter;
		}

		if (node &&
				typeof node.dataset !== "undefined" &&
				typeof node.dataset.breakBefore !== "undefined") {
			breakBefore = node.dataset.breakBefore;
		}

		if (force) {
			page = this.addPage(true);
		} else if( previousBreakAfter &&
				(previousBreakAfter === "left" || previousBreakAfter === "right") &&
				previousBreakAfter !== currentPosition) {
			page = this.addPage(true);
		} else if( previousBreakAfter &&
				(previousBreakAfter === "verso" || previousBreakAfter === "recto") &&
				previousBreakAfter !== currentSide) {
			page = this.addPage(true);
		} else if( breakBefore &&
				(breakBefore === "left" || breakBefore === "right") &&
				breakBefore !== currentPosition) {
			page = this.addPage(true);
		} else if( breakBefore &&
				(breakBefore === "verso" || breakBefore === "recto") &&
				breakBefore !== currentSide) {
			page = this.addPage(true);
		}

		if (page) {
			await this.hooks.beforePageLayout.trigger(page, undefined, undefined, this);
			this.emit("page", page);
			// await this.hooks.layout.trigger(page.element, page, undefined, this);
			await this.hooks.afterPageLayout.trigger(page.element, page, undefined, this);
			await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
			this.emit("renderedPage", page);
		}
	}

	async *layout(content, startAt) {
		let breakToken = startAt || false;
		let tokens = [];

		while (breakToken !== undefined && (MAX_PAGES ? this.total < MAX_PAGES : true)) {

			if (breakToken && breakToken.node) {
				await this.handleBreaks(breakToken.node);
			} else {
				await this.handleBreaks(content.firstChild);
			}

			let page = this.addPage();

			await this.hooks.beforePageLayout.trigger(page, content, breakToken, this);
			this.emit("page", page);

			// Layout content in the page, starting from the breakToken
			breakToken = await page.layout(content, breakToken, this.maxChars);

			if (breakToken) {
				let newToken = breakToken.toJSON(true);
				if (tokens.lastIndexOf(newToken) > -1) {
					// loop
					let err = new OverflowContentError("Layout repeated", [breakToken.node]);
					console.error("Layout repeated at: ", breakToken.node);
					return err;
				} else {
					tokens.push(newToken);
				}
			}

			await this.hooks.afterPageLayout.trigger(page.element, page, breakToken, this);
			await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
			this.emit("renderedPage", page);

			this.recoredCharLength(page.wrapper.textContent.length);

			yield breakToken;

			// Stop if we get undefined, showing we have reached the end of the content
		}


	}

	recoredCharLength(length) {
		if (length === 0) {
			return;
		}

		this.charsPerBreak.push(length);

		// Keep the length of the last few breaks
		if (this.charsPerBreak.length > 4) {
			this.charsPerBreak.shift();
		}

		this.maxChars = this.charsPerBreak.reduce((a, b) => a + b, 0) / (this.charsPerBreak.length);
	}

	removePages(fromIndex=0) {

		if (fromIndex >= this.pages.length) {
			return;
		}

		// Remove pages
		for (let i = fromIndex; i < this.pages.length; i++) {
			this.pages[i].destroy();
		}

		if (fromIndex > 0) {
			this.pages.splice(fromIndex);
		} else {
			this.pages = [];
		}

		this.total = this.pages.length;
	}

	addPage(blank) {
		let lastPage = this.pages[this.pages.length - 1];
		// Create a new page from the template
		let page = new Page(this.pagesArea, this.pageTemplate, blank, this.hooks, this.settings);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element, this.pageSize);
		this.pageSize = this.pageSize || page.size;

		// A re-layout from the first page puts it before the pages it keeps (Informma, CER-2976)
		if (!lastPage && this.relayBefore) {
			this.pagesArea.insertBefore(page.element, this.relayBefore);
		}

		page.index(this.total);

		if (!blank) {
			// Listen for page overflow
			page.onOverflow((overflowToken) => {
				console.warn("overflow on", page.id, overflowToken);

				// Only reflow while rendering
				if (this.rendered) {
					return;
				}

				let index = this.pages.indexOf(page) + 1;

				// Stop the rendering
				this.stop();

				// Set the breakToken to resume at
				this.breakToken = overflowToken;

				// Remove pages
				this.removePages(index);

				if (this.rendered === true) {
					this.rendered = false;

					this.q.enqueue(async () => {

						this.start();

						await this.render(this.source, this.breakToken);

						this.rendered = true;

					});
				}


			});

			page.onUnderflow((overflowToken) => {
				// console.log("underflow on", page.id, overflowToken);

				// page.append(this.source, overflowToken);

			});
		}

		this.total = this.pages.length;

		return page;
	}
	/*
	insertPage(index, blank) {
		let lastPage = this.pages[index];
		// Create a new page from the template
		let page = new Page(this.pagesArea, this.pageTemplate, blank, this.hooks);

		let total = this.pages.splice(index, 0, page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(index + 1);

		for (let i = index + 2; i < this.pages.length; i++) {
			this.pages[i].index(i);
		}

		if (!blank) {
			// Listen for page overflow
			page.onOverflow((overflowToken) => {
				if (total < this.pages.length) {
					this.pages[total].layout(this.source, overflowToken);
				} else {
					let newPage = this.addPage();
					newPage.layout(this.source, overflowToken);
				}
			});

			page.onUnderflow(() => {
				// console.log("underflow on", page.id);
			});
		}

		this.total += 1;

		return page;
	}
	*/

	async clonePage(originalPage) {
		let lastPage = this.pages[this.pages.length - 1];

		let page = new Page(this.pagesArea, this.pageTemplate, false, this.hooks);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element, this.pageSize);
		this.pageSize = this.pageSize || page.size;

		page.index(this.total);

		await this.hooks.beforePageLayout.trigger(page, undefined, undefined, this);
		this.emit("page", page);

		for (const className of originalPage.element.classList) {
			if (className !== "pagedjs_left_page" && className !== "pagedjs_right_page") {
				page.element.classList.add(className);
			}
		}

		await this.hooks.afterPageLayout.trigger(page.element, page, undefined, this);
		await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
		this.emit("renderedPage", page);
	}

	/**
	 * Lays the pages out again from each stretch holding a changed node, and stops where the layout meets the old one
	 * again (Informma, CER-2976 epic-05 sprint-08). The caller has changed this.source's text in place, and gives the
	 * text nodes it changed.
	 *
	 * A stretch runs from a page that starts at a forced break to the next, and nothing after it can move a break in
	 * it. Each stretch holding a change is laid out from its first page until the next page would start where the next
	 * stretch starts, in the same place (the pages laid out again number as many as those they replace), with every
	 * handler agreeing that the state carried there is the old layout's (relayoutConverges); otherwise the next stretch
	 * is laid out too. The pages from there on are kept where they are. Chrome lays a page out by where it sits in the
	 * pages area, to a fraction of a pixel, so a kept page that moved needn't be the page a full layout gives (measured,
	 * CER-2976 epic-05 sprint-08): an edit that adds or removes a page lays out to the end. With options.keepMoved,
	 * kept pages may move instead; they're renumbered and their margins sized again. The page count is off from the
	 * start until then, as during a layout, so counter(pages) reads as it did when the other pages' margins were sized.
	 *
	 * Refused, with nothing changed: before the layout ends, during another re-layout, for anything but a text node
	 * inside this.source, or when a handler gives a reason (beforeRelayout). A caller then lays out in full.
	 * @param {Array<Text>} changed the text nodes changed
	 * @param {object} [options] {keepMoved: keep the pages after a stretch that moved them}
	 * @returns {Promise<object>} {relaid: false, reason}, or {relaid: true, regions, pages, renumbered}
	 */
	async relayout(changed, options = {}) {
		let reason = this.relayoutRefusal(changed);
		if (reason) {
			return { relaid: false, reason };
		}
		this.relaying = true;
		try {
			let answers = await this.hooks.beforeRelayout.trigger(changed, this);
			reason = answers.find((answer) => typeof answer === "string" && answer);
			if (reason) {
				return { relaid: false, reason };
			}
			let area = this.pagesArea;
			let count = area.style.getPropertyValue("--pagedjs-page-count");
			area.style.removeProperty("--pagedjs-page-count");
			let places = new Map(this.pages.map((page, i) => [page, i]));
			let laidAgain = new Set();
			let regions = [];
			let shift = 0;
			for (let node of inDocumentOrder(changed)) {
				let first = this.stretchStart(node, laidAgain);
				if (first !== undefined) {
					let region = await this.relayStretch(first, laidAgain, options.keepMoved ? undefined : shift);
					regions.push(region);
					shift += region.shift;
				}
			}
			let moved = [];
			this.pages.forEach((page, i) => {
				if (places.has(page) && places.get(page) !== i) {
					page.index(i);
					moved.push(page);
				}
			});
			for (let page of moved) {
				await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
			}
			area.style.setProperty("--pagedjs-page-count", regions.length ? this.total : count);
			let result = { relaid: true, regions, pages: this.total, renumbered: moved.length };
			await this.hooks.afterRelayout.trigger(this.pages, result, this);
			this.emit("relaid", result);
			return result;
		} finally {
			this.relaying = false;
		}
	}

	/**
	 * Why a re-layout can't start, or nothing.
	 * @param {Array<Text>} changed the text nodes changed
	 * @returns {string|undefined} the reason
	 */
	relayoutRefusal(changed) {
		if (!this.rendered) {
			return "not-rendered";
		}
		if (this.relaying) {
			return "relaying";
		}
		if (!changed || !changed.length) {
			return "no-changes";
		}
		for (let node of changed) {
			if (!node || node.nodeType !== 3) {
				return "not-text";
			}
			if (!this.source || !this.source.contains(node)) {
				return "outside";
			}
		}
	}

	/**
	 * The first page of the stretch holding a changed node: back from the first page holding its element to a page
	 * that starts at a forced break, or the first page. Undefined if no page holds it, or if this re-layout has
	 * already laid that stretch out again.
	 * @param {Text} node a changed text node
	 * @param {Set<Page>} laidAgain the pages this re-layout has laid out
	 * @returns {number|undefined} the page's index
	 */
	stretchStart(node, laidAgain) {
		let element = node.parentElement;
		let ref = element && element.dataset && element.dataset.ref;
		let clone = ref && this.pagesArea.querySelector(`[data-ref="${ref}"]`);
		let pageElement = clone && clone.closest(".pagedjs_page");
		let at = pageElement ? this.pages.findIndex((page) => page.element === pageElement) : -1;
		if (at < 0) {
			return undefined;
		}
		while (at > 0 && !forcedStart(this.pages[at].startToken)) {
			at--;
		}
		return laidAgain.has(this.pages[at]) ? undefined : at;
	}

	/**
	 * Lays out the stretch from the page at `first` again, and the stretches after it while the carried state differs,
	 * or while the pages after would sit elsewhere. The stretch's own pages go; the pages after it stay in the pages
	 * area, and new pages are inserted before them.
	 * @param {number} first the stretch's first page's index
	 * @param {Set<Page>} laidAgain the pages this re-layout has laid out, to which the new ones are added
	 * @param {number} [shiftBefore] the earlier regions' shift, to keep the pages after only in place; undefined keeps
	 * them wherever they land
	 * @returns {Promise<object>} the region: {from (its page number), laid, replaced, shift}
	 */
	async relayStretch(first, laidAgain, shiftBefore) {
		let tail = this.pages.splice(first);
		let old = tail.splice(0, stretchLength(tail));
		let start = old[0].startToken;
		let lastOld = old[old.length - 1];
		let replaced = old.length;
		old.forEach((page) => page.destroy());
		this.total = this.pages.length;
		this.relayBefore = first === 0 && tail.length ? tail[0].element : undefined;
		await this.hooks.relayoutFrom.trigger(first, this);

		let layout = this.layout(this.source, start);
		let laid = 0;
		let ended = false;
		for (;;) {
			let step = await layout.next();
			if (step.done) {
				if (step.value instanceof Error) {
					throw step.value;
				}
				ended = true;
				break;
			}
			laid++;
			this.relayBefore = undefined;
			laidAgain.add(this.pages[this.pages.length - 1]);
			let token = step.value;
			if (token === undefined) {
				ended = true;
				break;
			}
			let next = tail[0];
			if (next && token.node === next.startToken.node && !token.offset) {
				let inPlace = shiftBefore === undefined || shiftBefore + laid - replaced === 0;
				let votes = inPlace ? await this.hooks.relayoutConverges.trigger(this.pages[this.pages.length - 1], lastOld, this) : [];
				if (inPlace && !votes.includes(false)) {
					break;
				}
				let more = tail.splice(0, stretchLength(tail));
				lastOld = more[more.length - 1];
				replaced += more.length;
				more.forEach((page) => page.destroy());
			}
		}
		this.relayBefore = undefined;
		if (ended) {
			replaced += tail.length;
			tail.splice(0).forEach((page) => page.destroy());
		}
		this.pages.push(...tail);
		this.total = this.pages.length;
		return { from: first + 1, laid, replaced, shift: laid - replaced };
	}

	loadFonts() {
		let fontPromises = [];
		(document.fonts || []).forEach((fontFace) => {
			if (fontFace.status !== "loaded") {
				let fontLoaded = fontFace.load().then((r) => {
					return fontFace.family;
				}, (r) => {
					console.warn("Failed to preload font-family:", fontFace.family);
					return fontFace.family;
				});
				fontPromises.push(fontLoaded);
			}
		});
		return Promise.all(fontPromises).catch((err) => {
			console.warn(err);
		});
	}

	destroy() {
		this.pagesArea.remove();
		this.pageTemplate.remove();
	}

}

EventEmitter(Chunker.prototype);

export default Chunker;
