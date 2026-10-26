import Handler from "../handler.js";
import {attr, querySelectorEscape, UUID} from "../../utils/utils.js";
import csstree from "css-tree";

class TargetCounters extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;

		this.counterTargets = {};

		// Each page's counter-reset and counter-increment, read once, by page element
		this.pageCounters = new WeakMap();

		// For each target, the links already looked for in the whole pages area
		this.searched = new Map();

		// The counters' rules, held until the layout ends: a page counter's as the link it numbers, its number
		// worked out then
		this.held = [];

		// Each page counter's rule once inserted, with the link it numbers and its text, for a re-layout to number
		// again (Informma, CER-2976)
		this.numbered = [];
	}

	onContent(funcNode, fItem, fList, declaration, rule) {
		if (funcNode.name === "target-counter") {
			let selector = csstree.generate(rule.ruleNode.prelude);

			let first = funcNode.children.first();
			let func = first.name;

			let value = csstree.generate(funcNode);

			let args = [];

			first.children.forEach((child) => {
				if (child.type === "Identifier") {

					args.push(child.name);
				}
			});

			let counter;
			let style;
			let styleIdentifier;

			funcNode.children.forEach((child) => {
				if (child.type === "Identifier") {
					if (!counter) {
						counter = child.name;
					} else if (!style) {
						styleIdentifier = csstree.clone(child);
						style = child.name;
					}
				}
			});

			let variable = "target-counter-" + UUID();

			selector.split(",").forEach((s) => {
				this.counterTargets[s] = {
					func: func,
					args: args,
					value: value,
					counter: counter,
					style: style,
					selector: s,
					fullSelector: selector,
					variable: variable
				};
			});

			// Replace with counter
			funcNode.name = "counter";
			funcNode.children = new csstree.List();
			funcNode.children.appendData({
				type: "Identifier",
				loc: 0,
				name: variable
			});

			if (styleIdentifier) {
				funcNode.children.appendData({type: "Operator", loc: null, value: ","});
				funcNode.children.appendData(styleIdentifier);
			}
		}
	}

	afterPageLayout(fragment, page, breakToken, chunker) {
		Object.keys(this.counterTargets).forEach((name) => {
			let target = this.counterTargets[name];
			let split = target.selector.split(/::?/g);
			let query = split[0];

			let queried = chunker.pagesArea.querySelectorAll(query + ":not([data-" + target.variable + "])");

			let searched = this.searched.get(target);
			if (!searched) {
				searched = new WeakSet();
				this.searched.set(target, searched);
			}

			queried.forEach((selected, index) => {
				// TODO: handle func other than attr
				if (target.func !== "attr") {
					return;
				}
				let val = attr(selected, target.args);
				// The first time a link is seen, its target is looked for in the whole pages area, as 0.4.3 does;
				// after that only in each new page, the one place it can first appear. The same as 0.4.3's wherever a
				// laid-out page gains no matching element later: the area's first match is then in the first page
				// holding one, and that's where this finds it.
				let scope = searched.has(selected) ? fragment : chunker.pagesArea;
				searched.add(selected);
				let element = scope.querySelector(querySelectorEscape(val));

				if (element) {
					let selector = UUID();
					selected.setAttribute("data-" + target.variable, selector);
					// TODO: handle other counter types (by query)
					let pseudo = "";
					if (split.length > 1) {
						pseudo += "::" + split[1];
					}
					if (target.counter === "page") {
						// Its page's number is worked out when the layout ends (afterRendered), by 0.4.3's walk
						this.held.push({target, selector, pseudo, element, pagesArea: chunker.pagesArea, val});
					} else {
						let value = element.getAttribute(`data-counter-${target.counter}-value`);
						if (value) {
							this.held.push(`[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${target.variable} ${parseInt(value)}; }`);
						}
					}

					// 0.4.3's "force redraw", less its forced layout (a read of clientHeight between the two): the rule
					// it redrew for is now inserted when the layout ends. The two style changes stay, so the link keeps
					// the style="" they leave on it, as in 0.4.3.
					let el = document.querySelector(`[data-${target.variable}="${selector}"]`);
					if (el) {
						el.style.display = "none";
						el.style.removeProperty("display");
					}
				}
			});
		});
	}

	/**
	 * The counters' rules, inserted when the layout ends, in the order their links were numbered, into the same
	 * stylesheet. 0.4.3 inserted each as its target was laid out, and every insertion cost a style recalculation of
	 * the pages laid out so far, paid at the next style read, whichever handler made it. Held, the final document is
	 * the same, and the numbers are drawn when the layout ends rather than as each target is laid out: until then a
	 * link shows its counter unset, 0, as a link whose target never appears always has.
	 *
	 * Not 0.4.3's where drawing a number would resize a laid-out page's content: 0.4.3's overflow observer would
	 * re-lay out from that page during the layout; after it, the layout is rendered and it doesn't.
	 *
	 * A page counter's number is worked out here too, not as its target is found: by 0.4.3's walk, over the pages
	 * from the first to the one holding the target, reading each page's counter styles. Pages are only ever
	 * appended, so the pages before the target's are the ones 0.4.3 walked; and no page's counter styles are read
	 * while the pages are laid out, which a handler holding them (HeldPageCounters) needs. Assumes the target's page
	 * is still in the document, as it is unless an overflow laid that page out again.
	 */
	afterRendered() {
		// Every number first, then every rule: a rule inserted before a page's counter styles are read would cost
		// that read a style recalculation, as each did 0.4.3's next read during the layout
		let held = this.held;
		let rules = held.map((rule) => typeof rule === "string" ? rule : this.pageRule(rule));
		this.held = [];
		this.insertHeld(held, rules);
	}

	/**
	 * Appends the held rules to the sheet, in order, keeping each page counter's rule with its link and text.
	 * @param {Array} held the held rules: strings, and page counters' links
	 * @param {Array<string>} rules their rules' text
	 * @returns {undefined} nothing
	 */
	insertHeld(held, rules) {
		rules.forEach((rule, i) => {
			let index = this.styleSheet.cssRules.length;
			this.styleSheet.insertRule(rule, index);
			if (typeof held[i] !== "string") {
				this.numbered.push({link: held[i], rule: this.styleSheet.cssRules[index], text: rule});
			}
		});
	}

	/**
	 * After a re-layout from a changed stretch (Informma, CER-2976): every page counter's number worked out again,
	 * by the same walk, its target found again in the pages area as when it was first numbered. A changed number's
	 * rule is rewritten at its own place in the sheet; a link the re-layout laid out anew is numbered, its rule
	 * appended, as when a layout ends; and the rule of a link no longer in the pages is removed.
	 * @param {Array<Page>} pages the pages
	 * @param {object} result the re-layout's result
	 * @param {Chunker} chunker the chunker
	 * @returns {undefined} nothing
	 */
	afterRelayout(pages, result, chunker) {
		let area = chunker.pagesArea;
		let sheet = this.styleSheet;
		let kept = [];
		let gone = [];
		for (let entry of this.numbered) {
			let {target, selector, val} = entry.link;
			if (area.querySelector(`[data-${target.variable}="${selector}"]`)) {
				entry.link.element = area.querySelector(querySelectorEscape(val)) || entry.link.element;
				kept.push(entry);
			} else {
				gone.push(entry);
			}
		}
		// Every number first, then every rule, as afterRendered
		let numbers = kept.map((entry) => this.pageRule(entry.link));
		let held = this.held;
		let rules = held.map((rule) => typeof rule === "string" ? rule : this.pageRule(rule));
		this.held = [];
		kept.forEach((entry, i) => {
			if (numbers[i] !== entry.text) {
				let at = Array.prototype.indexOf.call(sheet.cssRules, entry.rule);
				sheet.deleteRule(at);
				sheet.insertRule(numbers[i], at);
				entry.rule = sheet.cssRules[at];
				entry.text = numbers[i];
			}
		});
		gone.forEach((entry) => {
			let at = Array.prototype.indexOf.call(sheet.cssRules, entry.rule);
			if (at >= 0) {
				sheet.deleteRule(at);
			}
		});
		this.numbered = kept;
		this.insertHeld(held, rules);
	}

	/**
	 * A page counter's rule for a link numbered during the layout: 0.4.3's walk, then its rule.
	 * @param {object} link the target, the link's selector and pseudo-element, the target element and the pages area
	 * @returns {string} the rule
	 */
	pageRule({target, selector, pseudo, element, pagesArea}) {
		let pages = pagesArea.querySelectorAll(".pagedjs_page");
		let pg = 0;
		for (let i = 0; i < pages.length; i++) {
			let page = pages[i];
			let {reset, increment} = this.pageCountersOf(page);

			if (reset !== "none") {
				pg = parseInt(reset);
			}
			if (increment !== "none") {
				pg += parseInt(increment);
			}

			if (page.contains(element)){
				break;
			}
		}
		return `[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${pg}; }`;
	}

	/**
	 * A page's counter-reset and counter-increment, as the walk reads them, the page counter's name taken out.
	 * Read the first time a walk needs them, when the layout has ended, and kept by page element. Assumes a page's
	 * counter styles don't change after the layout, as none of Paged.js's handlers changes them: Counters inserts a
	 * page's own rule at that page's afterPageLayout.
	 */
	pageCountersOf(page) {
		let kept = this.pageCounters.get(page);
		if (!kept) {
			let styles = window.getComputedStyle(page);
			kept = {
				reset: styles["counter-reset"].replace("page", "").trim(),
				increment: styles["counter-increment"].replace("page", "").trim()
			};
			this.pageCounters.set(page, kept);
		}
		return kept;
	}
}

export default TargetCounters;
