// Runs the page's three scripts, suncalc.js, cities.js and then the compiled app.js, in a fresh
// node:vm context, one global scope as in a browser, with a clock fixed at a given instant (a test
// can move it). No browser and no DOM library: app.js is a classic script that reads the page as
// it loads, so it cannot be imported; this runs it as the page does.
//
// Two ways to load it:
//   * loadModel: no document, so app.js skips its DOM layer, and a test calls the model functions
//     (dayEnergy, yearEnergy, parseDecimal and the others) in the page's global scope.
//   * loadPage: with a stub of the page parts app.js touches, as index.html has them before app.js
//     runs. A test then types in the city search, presses keys, picks a city, switches the tab,
//     types coordinates and a price, moves a slider, changes the date or the currency, presses
//     Estimate and the report button, and drags the scene, through the same listeners the page
//     uses. A click is delivered as the browser delivers it: to the element, then (bubbling) to
//     each parent and to the document. The debounce timer of the search runs at once, in order.

import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An event as app.js reads it. */
interface StubEvent {
  type: string;
  target: StubElement;
  key: string;
  clientX: number;
  pointerId: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}
type Listener = (event: StubEvent) => void;

/** A page element with only what app.js uses (the Element of the page). */
class StubElement {
  readonly tag: string;
  readonly ns: string;
  id = '';
  hidden = false;
  #text = '';
  #classes: string[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style = new StubStyle();
  readonly children: StubElement[] = [];
  parentElement: StubElement | null = null;
  readonly listeners = new Map<string, Listener[]>();
  readonly classList = {
    toggle: (name: string, on: boolean): boolean => {
      this.#classes = this.#classes.filter((c) => c !== name);
      if (on) this.#classes.push(name);
      return on;
    },
    contains: (name: string): boolean => this.#classes.includes(name),
  };
  constructor(tag: string, ns = '') { this.tag = tag; this.ns = ns; }
  get className(): string { return this.#classes.join(' '); }
  set className(value: string) { this.#classes = value.split(' ').filter(Boolean); }
  /** The text of the element and everything below it; setting it removes the children. */
  get textContent(): string { return this.children.length ? this.children.map((c) => c.textContent).join('') : this.#text; }
  set textContent(value: string) {
    for (const c of this.children.splice(0)) c.parentElement = null;
    this.#text = value;
  }
  appendChild(child: StubElement): StubElement { this.children.push(child); child.parentElement = this; return child; }
  append(...nodes: StubElement[]): void { for (const n of nodes) this.appendChild(n); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  /** The first element below this one with this tag name (the only selector app.js uses here). */
  querySelector(tag: string): StubElement | null {
    for (const c of this.children) {
      if (c.tag === tag) return c;
      const deeper = c.querySelector(tag);
      if (deeper) return deeper;
    }
    return null;
  }
  /** This element or the nearest parent with the class in ".name" (the only selector app.js uses). */
  closest(selector: string): StubElement | null {
    if (!selector.startsWith('.')) throw new Error(`the stub cannot match ${selector}`);
    for (let e: StubElement | null = this; e; e = e.parentElement) if (e.classList.contains(selector.slice(1))) return e;
    return null;
  }
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  focus(): void { page.focused = this.id || this.tag; }
  scrollIntoView(): void { page.scrolled.push(this.textContent); }
  setPointerCapture(id: number): void { page.captured.push(id); }
  /** The element as markup-like text, for comparing two states: tag, id, class, attributes, data,
   *  style, hidden, value, then the own text or the children. */
  serialise(): string {
    const head = [this.tag + (this.id ? `#${this.id}` : '')];
    if (this.className) head.push(`class="${this.className}"`);
    for (const [k, v] of [...this.attributes].sort()) head.push(`${k}="${v}"`);
    for (const [k, v] of Object.entries(this.dataset).sort()) head.push(`data-${k}="${v}"`);
    if (this.style.text()) head.push(`style="${this.style.text()}"`);
    if (this.hidden) head.push('hidden');
    if (this instanceof StubInput || this instanceof StubSelect) head.push(`value="${this.value}"`);
    const body = this.children.length ? this.children.map((c) => c.serialise()).join('') : this.#text;
    return `<${head.join(' ')}>${body}</${this.tag}>`;
  }
}
/** The style of an element: custom properties set with setProperty, in the order set. */
class StubStyle {
  readonly #props = new Map<string, string>();
  setProperty(name: string, value: string): void { this.#props.set(name, String(value)); }
  getPropertyValue(name: string): string { return this.#props.get(name) ?? ''; }
  text(): string { return [...this.#props].map(([k, v]) => `${k}: ${v};`).join(' '); }
}
// The kinds app.js checks with instanceof.
class StubHTMLElement extends StubElement {}
class StubInput extends StubHTMLElement { value = ''; }
class StubSelect extends StubHTMLElement { value = ''; }
class StubButton extends StubHTMLElement {}
class StubList extends StubHTMLElement {}
class StubTable extends StubHTMLElement {}
class StubTableSection extends StubHTMLElement {}
class StubSVGElement extends StubElement {}

/** What the page did besides its elements: the focus, the rows scrolled into view, the pointer
 *  captures and the print dialogs. */
const page: { focused: string; scrolled: string[]; captured: number[]; prints: number } = { focused: '', scrolled: [], captured: [], prints: 0 };

/** What the page shows. */
export interface PageState {
  /** The whole stub page, serialised. */
  body: string;
  focus: string;
  scrolled: string[];
  captured: number[];
  prints: number;
}

/** The model functions, run in the page's global scope. */
export interface Model {
  /** Runs an expression in the page's global scope and returns its value. */
  run(expression: string): unknown;
  /** The same, for an expression that gives a number. */
  number(expression: string): number;
  /** The same, for an expression that gives an array of numbers. */
  numbers(expression: string): number[];
  /** The same, for an expression that gives a string, or undefined. */
  text(expression: string): string | undefined;
}

export interface Page extends Model {
  state(): PageState;
  /** Types text into a text field (the city search, a coordinate, the price), as the input
   *  event delivers it; the search's debounce timer then runs. */
  type(id: string, text: string): void;
  /** Sets a slider to a value, as the input event delivers it. */
  slide(id: string, value: number): void;
  /** Sets the date field or the currency and sends the change event. */
  change(id: string, value: string): void;
  /** A key pressed in the city search (ArrowDown, ArrowUp, Enter, Escape). */
  key(key: string): void;
  /** Clicks an element by id (bubbling to the document). */
  click(id: string): void;
  /** Clicks row i of the city list (bubbling to the document). */
  pick(i: number): void;
  /** Clicks somewhere else on the page. */
  clickOutside(): void;
  /** Drags the scene from x0 to x1 with the pointer. */
  drag(x0: number, x1: number): void;
  /** Moves the clock. */
  setNow(t: number): void;
}

/** One expression's value as a number, or a failed test. */
const asNumber = (v: unknown, expression: string): number => {
  if (typeof v !== 'number') throw new Error(`${expression} is not a number: ${String(v)}`);
  return v;
};

/** Loads suncalc.js, cities.js and app.js from root (a directory URL) into a context with these
 *  globals, and gives the model functions. */
function load(root: URL, globals: Record<string, unknown>): { context: Context; model: Model } {
  const context = createContext(globals);
  runInContext('var window = globalThis;', context);
  for (const file of ['suncalc.js', 'cities.js', 'app.js']) {
    runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  }
  const run = (expression: string): unknown => runInContext(expression, context);
  const model: Model = {
    run,
    number: (expression) => asNumber(run(expression), expression),
    numbers: (expression) => {
      const v = run(expression);
      if (!Array.isArray(v)) throw new Error(`${expression} is not an array`);
      return v.map((x: unknown) => asNumber(x, expression));
    },
    text: (expression) => {
      const v = run(expression);
      if (v !== undefined && typeof v !== 'string') throw new Error(`${expression} is not a string: ${String(v)}`);
      return v;
    },
  };
  return { context, model };
}

/** The model alone: no document, as the old test.js loaded app.js in Node. */
export function loadModel(root: URL): Model {
  return load(root, {}).model;
}

/** The page at the instant now, after app.js has run. */
export function loadPage(root: URL, now: number): Page {
  let clock = now;
  page.focused = ''; page.scrolled = []; page.captured = []; page.prints = 0;
  const byId = new Map<string, StubElement>();
  const make = (kind: new (tag: string, ns?: string) => StubElement, tag: string, id = '', className = '', opts: { hidden?: boolean; text?: string; value?: string; attrs?: Record<string, string>; data?: Record<string, string> } = {}): StubElement => {
    const e = new kind(tag);
    e.id = id; e.className = className; e.hidden = opts.hidden ?? false;
    if (opts.text) e.textContent = opts.text;
    if (opts.value !== undefined && (e instanceof StubInput || e instanceof StubSelect)) e.value = opts.value;
    for (const [k, v] of Object.entries(opts.attrs ?? {})) e.setAttribute(k, v);
    Object.assign(e.dataset, opts.data ?? {});
    if (id) byId.set(id, e);
    return e;
  };
  const div = (id: string, className = '', hidden = false): StubElement => make(StubHTMLElement, 'div', id, className, { hidden });
  const p = (id: string, className: string, hidden: boolean, text = ''): StubElement => make(StubHTMLElement, 'p', id, className, { hidden, text });
  const span = (id: string, className: string, text = ''): StubElement => make(StubHTMLElement, 'span', id, className, { text });
  const input = (id: string, className: string, value = '', attrs: Record<string, string> = {}): StubElement => make(StubInput, 'input', id, className, { value, attrs });
  const slider = (id: string, value: string, readout: string, text: string): StubElement => {
    const g = div('', 'slider-group');
    g.append(span(readout, 'slider-readout mono', text), input(id, '', value, { type: 'range' }));
    return g;
  };

  // The page parts, as index.html has them before app.js runs.
  const body = make(StubHTMLElement, 'body');
  const main = body.appendChild(make(StubHTMLElement, 'main', '', 'main-container'));
  const card = main.appendChild(make(StubHTMLElement, 'section', '', 'card input-card'));
  const tabs = card.appendChild(div('', 'tab-group'));
  tabs.append(
    make(StubButton, 'button', 'tab-city', 'tab active', { text: 'City Search', attrs: { 'aria-selected': 'true' }, data: { tab: 'city' } }),
    make(StubButton, 'button', 'tab-gps', 'tab', { text: 'GPS Coords', attrs: { 'aria-selected': 'false' }, data: { tab: 'gps' } }));
  const panelCity = card.appendChild(div('panel-city', 'tab-panel active'));
  const wrapper = panelCity.appendChild(div('', 'search-wrapper'));
  wrapper.append(input('city-search', 'search-input', '', { 'aria-expanded': 'false' }), make(StubList, 'ul', 'city-dropdown', 'dropdown', { hidden: true }));
  const selected = panelCity.appendChild(div('city-selected', 'selected-city', true));
  selected.append(span('city-selected-text', ''), make(StubButton, 'button', 'city-clear-btn', 'clear-btn', { text: '×' }));
  const panelGps = card.appendChild(div('panel-gps', 'tab-panel', true));
  panelGps.append(input('lat-input', 'text-input'), p('lat-error', 'field-error', true), input('lon-input', 'text-input'), p('lon-error', 'field-error', true), p('gps-echo', 'field-note', true));
  card.append(
    slider('azimuth-input', '180', 'azimuth-readout', '180° · S'),
    slider('tilt-input', '35', 'tilt-readout', '35°'),
    slider('area-input', '20', 'area-readout', '20 m²'),
    slider('efficiency-input', '20', 'efficiency-readout', '20%'),
    slider('losses-input', '14', 'losses-readout', '14%'),
    slider('clearness-input', '65', 'clearness-readout', '65%'),
    input('date-input', 'text-input', '', { type: 'date' }),
    input('price-input', 'text-input', '1.50'),
    p('price-error', 'field-error', true),
    make(StubSelect, 'select', 'currency-select', 'text-input', { value: 'kr' }),
    p('price-echo', 'field-note', true),
    make(StubButton, 'button', 'calculate-btn', 'btn btn-primary', { text: 'Estimate Solar Yield' }),
    p('error-msg', 'error-msg', true));
  const scene = main.appendChild(make(StubHTMLElement, 'section', '', 'card scene-card'));
  const viewport = scene.appendChild(div('scene-viewport', 'scene-viewport'));
  const house = viewport.appendChild(div('scene-world', 'scene-world')).appendChild(div('house', 'house'));
  house.appendChild(div('roof-front', 'roof-plane roof-front')).appendChild(div('panel-grid', 'panel-grid'));
  scene.appendChild(p('scene-readout', 'scene-readout mono', false, 'Facing S (180°) · Tilt 35° · 20 m²'));
  const results = main.appendChild(make(StubHTMLElement, 'section', 'results-card', 'card results-card', { hidden: true }));
  results.append(
    span('res-location', 'pill-value mono'), span('res-date', 'pill-value'), span('res-setup', 'pill-value mono'),
    div('res-day-kwh', 'sun-time-value mono'), div('res-annual-kwh', 'sun-time-value mono'), div('res-saving', 'sun-time-value mono'),
    make(StubHTMLElement, 'h3', 'hourly-chart-title', 'chart-title'), div('hourly-chart', 'chart-container'),
    make(StubHTMLElement, 'h3', 'monthly-chart-title', 'chart-title'), div('monthly-chart', 'chart-container'),
    make(StubButton, 'button', 'report-btn', 'btn btn-secondary', { text: 'Download PDF Report' }));
  const report = body.appendChild(make(StubHTMLElement, 'section', 'print-report', 'print-report'));
  report.appendChild(p('report-generated', 'report-generated', false));
  for (const id of ['report-inputs', 'report-results']) report.appendChild(make(StubTable, 'table', id, 'report-table')).appendChild(make(StubTableSection, 'tbody'));
  report.appendChild(make(StubTable, 'table', 'report-monthly', 'report-table report-monthly')).append(make(StubTableSection, 'thead'), make(StubTableSection, 'tbody'));

  const docListeners: Listener[] = [];
  const event = (type: string, target: StubElement, more: Partial<Pick<StubEvent, 'key' | 'clientX' | 'pointerId'>> = {}): StubEvent => ({
    type, target, key: more.key ?? '', clientX: more.clientX ?? 0, pointerId: more.pointerId ?? 0, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  });
  /** Delivers an event to the element and, for a click, to each parent and the document. */
  const dispatch = (target: StubElement, ev: StubEvent): void => {
    for (let e: StubElement | null = target; e; e = ev.type === 'click' ? e.parentElement : null) {
      for (const fn of e.listeners.get(ev.type) ?? []) fn(ev);
    }
    if (ev.type === 'click') for (const fn of docListeners) fn(ev);
  };

  // The search's debounce timer: setTimeout queues, flush runs what is queued, in order.
  let timers: { id: number; fn: () => void }[] = [];
  let nextTimer = 1;
  const flush = (): void => { while (timers.length) { const t = timers.shift(); t?.fn(); } };

  // The clock: new Date() and Date.now() give the fixed instant; every other use is the real Date.
  class FixedDate extends Date {
    constructor(...args: [] | [number | string | Date]) {
      if (args.length === 0) super(clock); else super(args[0]);
    }
    static override now(): number { return clock; }
  }

  const { model } = load(root, {
    Date: FixedDate,
    Element: StubElement,
    HTMLElement: StubHTMLElement,
    HTMLInputElement: StubInput,
    HTMLSelectElement: StubSelect,
    HTMLButtonElement: StubButton,
    HTMLUListElement: StubList,
    HTMLTableElement: StubTable,
    HTMLTableSectionElement: StubTableSection,
    setTimeout: (fn: () => void): number => { const id = nextTimer++; timers.push({ id, fn }); return id; },
    clearTimeout: (id: number | undefined): void => { timers = timers.filter((t) => t.id !== id); },
    print: (): void => { page.prints++; },
    document: {
      getElementById: (id: string): StubElement | null => byId.get(id) ?? null,
      addEventListener: (type: string, fn: Listener): void => { if (type !== 'click') throw new Error(`the stub document has no ${type} event`); docListeners.push(fn); },
      createElement: (tag: string): StubElement => new StubHTMLElement(tag),
      createElementNS: (ns: string, tag: string): StubElement => { if (ns !== SVG_NS) throw new Error(`the stub has no namespace ${ns}`); return new StubSVGElement(tag, ns); },
    },
  });

  const get = (id: string): StubElement => {
    const e = byId.get(id);
    if (!e) throw new Error(`no stub #${id}`);
    return e;
  };
  const field = (id: string): StubInput | StubSelect => {
    const e = get(id);
    if (!(e instanceof StubInput || e instanceof StubSelect)) throw new Error(`#${id} is not a field`);
    return e;
  };
  return {
    ...model,
    state: () => ({ body: body.serialise(), focus: page.focused, scrolled: [...page.scrolled], captured: [...page.captured], prints: page.prints }),
    type: (id, text) => { field(id).value = text; dispatch(get(id), event('input', get(id))); flush(); },
    slide: (id, value) => { field(id).value = String(value); dispatch(get(id), event('input', get(id))); },
    change: (id, value) => { field(id).value = value; dispatch(get(id), event('change', get(id))); },
    key: (key) => { dispatch(get('city-search'), event('keydown', get('city-search'), { key })); },
    click: (id) => { dispatch(get(id), event('click', get(id))); },
    pick: (i) => {
      const li = get('city-dropdown').children[i];
      if (!li) throw new Error(`the list has no row ${i}`);
      dispatch(li, event('click', li));
    },
    clickOutside: () => { dispatch(body, event('click', body)); },
    drag: (x0, x1) => {
      dispatch(viewport, event('pointerdown', viewport, { clientX: x0, pointerId: 7 }));
      dispatch(viewport, event('pointermove', viewport, { clientX: x1, pointerId: 7 }));
      dispatch(viewport, event('pointerup', viewport, { clientX: x1, pointerId: 7 }));
    },
    setNow: (t) => { clock = t; },
  };
}
