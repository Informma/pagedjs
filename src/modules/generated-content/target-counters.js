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
						let pages = chunker.pagesArea.querySelectorAll(".pagedjs_page");
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
						this.styleSheet.insertRule(`[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${pg}; }`, this.styleSheet.cssRules.length);
					} else {
						let value = element.getAttribute(`data-counter-${target.counter}-value`);
						if (value) {
							this.styleSheet.insertRule(`[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${target.variable} ${parseInt(value)}; }`, this.styleSheet.cssRules.length);
						}
					}

					// force redraw
					let el = document.querySelector(`[data-${target.variable}="${selector}"]`);
					if (el) {
						el.style.display = "none";
						el.clientHeight;
						el.style.removeProperty("display");
					}
				}
			});
		});
	}

	/**
	 * A page's counter-reset and counter-increment, as the walk reads them, the page counter's name taken out.
	 * Read the first time a walk needs them, when 0.4.3 would first read them, and kept by page element: a page
	 * removed on overflow and laid out again is a new element, read afresh. Assumes a page's counter styles don't
	 * change after its first read, as none of Paged.js's handlers changes them: Counters inserts a page's own rule
	 * at that page's afterPageLayout, which runs before this handler's.
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
