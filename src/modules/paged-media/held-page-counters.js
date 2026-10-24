import Handler from "../handler.js";

const MARGIN_CONTENT = /\.pagedjs_margin-content::after$/;
const PAGE_COUNTER = /(^|[\s,])pages?($|[\s,])/;
// Paged.js's own rules, by their last compound selector: an in-page host may prefix them with its container's
const PAGE_RULE = /(^|\s)\.pagedjs_page$/;
const PAGES_RULE = /(^|\s)\.pagedjs_pages$/;

/**
 * Holds the page counters while the pages are laid out, and sizes the margin boxes when the layout ends (Informma,
 * CER-2976).
 *
 * With the page counter in force on every page, Chrome brings every CSS counter in the document up to date each time
 * a page is inserted, at a cost that grows with the pages before it. While holding, no page has a counter-increment,
 * and each margin box whose content names the page counter is blank. AtPage sizes the margin groups from their boxes'
 * text widths (finalizePage), and no text drawn without a counter measures exactly as a counter's (in Chrome 152 a
 * counter's text is a fraction of a pixel wider than the same string's), so while holding AtPage queues its sizing on
 * the Chunker (deferredMargins). When the layout ends, before any other handler's afterRendered, the rules are put
 * back and the queued sizing runs, page by page, with the counters in force and --pagedjs-page-count taken off the
 * pages area for the while, so that counter(pages) reads 0 as it does during 0.4.3's layout: every margin box is
 * measured with 0.4.3's text. Then the count is put back. The margin boxes are blank, and unsized, until then.
 *
 * Only a document whose page numbering is the simple case qualifies (holdPlan): its page counters in margin boxes,
 * in the decimal style, with no page resets or increments of its own. Any other runs 0.4.3's path.
 */
class HeldPageCounters extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.holding = false;

		// What the hold changed, to put back: [style, property, value, priority]
		this.restore = [];
	}

	afterParsed(parsed) {
		let inContent = !!(parsed && parsed.querySelector &&
			parsed.querySelector("[data-counter-page-reset], [data-counter-page-increment]"));
		let plan = holdPlan(styleRules(this.polisher), inContent);
		if (!plan) {
			return;
		}
		for (let [rule, property, held] of plan) {
			let style = rule.style;
			let priority = style.getPropertyPriority(property);
			this.restore.push([style, property, style.getPropertyValue(property), priority]);
			style.setProperty(property, held, priority);
		}
		this.holding = true;
		this.chunker.deferredMargins = [];
	}

	afterRendered(pages) {
		if (!this.holding) {
			return;
		}
		for (let [style, property, value, priority] of this.restore) {
			style.setProperty(property, value, priority);
		}
		this.restore = [];
		this.holding = false;
		let area = this.chunker.pagesArea;
		let count = area.style.getPropertyValue("--pagedjs-page-count");
		area.style.removeProperty("--pagedjs-page-count");
		let sizing = this.chunker.deferredMargins;
		delete this.chunker.deferredMargins;
		sizing.forEach((size) => size());
		area.style.setProperty("--pagedjs-page-count", count);
	}
}

/**
 * Every style rule in Paged.js's own sheets, the base one and those it inserted the converted CSS into, @media and
 * other grouping rules' included, in document order.
 * @param {object} polisher the Polisher
 * @returns {Array} CSSStyleRules
 */
function styleRules(polisher) {
	let sheets = [polisher.styleSheet].concat((polisher.inserted || []).map((style) => style.sheet));
	let rules = [];
	let walk = (list) => {
		for (let rule of Array.from(list || [])) {
			if (rule.selectorText !== undefined && rule.style) {
				rules.push(rule);
			} else if (rule.cssRules) {
				walk(rule.cssRules);
			}
		}
	};
	for (let sheet of sheets) {
		if (sheet) {
			walk(sheet.cssRules);
		}
	}
	return rules;
}

/**
 * What to hold, or null if the document's page numbering isn't the simple case.
 * Holds `.pagedjs_page`'s counter-increment (Paged.js's own), and each margin box's content that names a page
 * counter. Refuses: a page counter in content outside a margin box; one heldContent can't hold; a counter-reset or
 * counter-set of `page` outside `.pagedjs_pages` (Paged.js's own); a counter-increment of `page` outside
 * `.pagedjs_page`; a page increment other than Paged.js's default of 1 (`--pagedjs-page-counter-increment`, which
 * PageCounterIncrement sets); page resets or increments marked in the content (inContent); or no increment of the
 * pages to hold. Paged.js's own rules are known by their last compound selector, and the default increment by its
 * value, since an in-page host scopes :root's rules to its container and may prefix the rest.
 * @param {Array} rules style rules, each with selectorText and a style answering getPropertyValue
 * @param {boolean} inContent whether Counters marked a page reset or increment in the parsed content
 * @returns {Array|null} [rule, property, held value] for each change, in the rules' order
 */
function holdPlan(rules, inContent) {
	if (inContent) {
		return null;
	}
	let plan = [];
	let increment = false;
	for (let rule of rules) {
		let style = rule.style;
		let selector = rule.selectorText;
		let inc = style.getPropertyValue("counter-increment");
		if (PAGE_COUNTER.test(inc)) {
			if (!PAGE_RULE.test(selector) || !/^page\s/.test(inc.trim() + " ")) {
				return null;
			}
			plan.push([rule, "counter-increment", "none"]);
			increment = true;
		}
		for (let property of ["counter-reset", "counter-set"]) {
			if (PAGE_COUNTER.test(style.getPropertyValue(property)) && !PAGES_RULE.test(selector)) {
				return null;
			}
		}
		let byPage = declared(style, "--pagedjs-page-counter-increment").trim();
		if (byPage && byPage !== "1") {
			return null;
		}
		let content = style.getPropertyValue("content");
		if (content && /counters?\(|target-counter/.test(content)) {
			if (!MARGIN_CONTENT.test(selector)) {
				if (namesPageCounter(content)) {
					return null;
				}
				continue;
			}
			let held = heldContent(content);
			if (!held) {
				return null;
			}
			if (held.changed) {
				plan.push([rule, "content", held.value]);
			}
		}
	}
	return increment ? plan : null;
}

/**
 * A property's value if the rule declares it, else "". Chrome 152 answers "unset" for any custom property of a rule
 * with all: unset (Paged.js's own [data-footnote-call] rule), though all doesn't reach custom properties and the rule
 * declares none; so a custom property is looked for among the declarations.
 * @param {CSSStyleDeclaration} style a rule's style
 * @param {string} property the property
 * @returns {string} its value, or ""
 */
function declared(style, property) {
	if (typeof style.length !== "number") {
		return style.getPropertyValue(property);
	}
	for (let i = 0; i < style.length; i++) {
		if (style[i] === property) {
			return style.getPropertyValue(property);
		}
	}
	return "";
}

/**
 * Whether a content value names the page or pages counter, in counter() or counters().
 * @param {string} value a content value
 * @returns {boolean} whether it does
 */
function namesPageCounter(value) {
	let tokens = tokenise(value);
	return !tokens || tokens.some((t) => t.func && /^counters?$/i.test(t.func) && PAGE_COUNTER.test(t.args));
}

/**
 * A margin box's content value while held: blank ("") if it names counter(page) or counter(pages), in the decimal
 * style, and nothing else it can't hold; as it is if it names neither. Null if the value names any other counter, a
 * counter style, counters() or target-counter(), or can't be read.
 * @param {string} value a content value, as the CSSOM serialises it
 * @returns {object|null} {value, changed}
 */
function heldContent(value) {
	let tokens = tokenise(value);
	if (!tokens) {
		return null;
	}
	let changed = false;
	let out = [];
	for (let token of tokens) {
		if (!token.func) {
			out.push(token.text);
			continue;
		}
		let name = token.func.toLowerCase();
		if (name === "counter") {
			let args = token.args.split(",").map((a) => a.trim());
			if (args.length > 2 || (args.length === 2 && args[1] !== "decimal")) {
				return null;
			}
			if (args[0] !== "page" && args[0] !== "pages") {
				return null;
			}
			changed = true;
		} else if (/counter/i.test(name) || /counters?\(|target-counter/i.test(token.args)) {
			return null;
		} else {
			out.push(token.text);
		}
	}
	return changed ? {value: "\"\"", changed} : {value: out.join(""), changed};
}

/**
 * A CSS value as tokens: strings, functions (with their arguments' text, nested parentheses and strings respected)
 * and everything else as written. Null for an unclosed string or function.
 * @param {string} value a CSS value
 * @returns {Array|null} tokens, each {text} and, for a function, {func, args}
 */
function tokenise(value) {
	let tokens = [];
	let i = 0;
	let n = value.length;
	let readString = (at) => {
		let quote = value[at];
		let j = at + 1;
		while (j < n && value[j] !== quote) {
			j += value[j] === "\\" ? 2 : 1;
		}
		return j < n ? j + 1 : -1;
	};
	while (i < n) {
		let c = value[i];
		if (c === "\"" || c === "'") {
			let end = readString(i);
			if (end < 0) {
				return null;
			}
			tokens.push({text: value.slice(i, end)});
			i = end;
			continue;
		}
		let name = /^[-\w]+\(/.exec(value.slice(i));
		if (name) {
			let start = i + name[0].length;
			let depth = 1;
			let j = start;
			while (j < n && depth > 0) {
				if (value[j] === "\"" || value[j] === "'") {
					j = readString(j);
					if (j < 0) {
						return null;
					}
					continue;
				}
				depth += value[j] === "(" ? 1 : value[j] === ")" ? -1 : 0;
				j++;
			}
			if (depth > 0) {
				return null;
			}
			tokens.push({text: value.slice(i, j), func: name[0].slice(0, -1), args: value.slice(start, j - 1)});
			i = j;
			continue;
		}
		let j = i + 1;
		while (j < n && value[j] !== "\"" && value[j] !== "'" && !/^[-\w]+\(/.test(value.slice(j))) {
			j++;
		}
		tokens.push({text: value.slice(i, j)});
		i = j;
	}
	return tokens;
}

export default HeldPageCounters;
export { heldContent, holdPlan };
