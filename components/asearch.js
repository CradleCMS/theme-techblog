/* asearch.js
 * CradleCMS AutoSearch component
 * version 1.1.2
 */
const searchCSS = new CSSStyleSheet()

searchCSS.replaceSync(`
:host {
    position: relative;
    display: inline-block;
}
:host(.asearch-wrapper) {
    width: fit-content;
    border: none;
    height: auto;
}
.asearch {
    position: absolute;
    display: none;
    margin: 0;
    top: 100%;
    left: 0;
    padding: 0;
    width: -webkit-fill-available;
    width: -moz-available;
    width: fill-available;
    max-height: 24em;
    background: var(--ok-bg-0);
    border: var(--ok-b-1);
    border-top: none;
    border-radius: 0 0 var(--radius-selector) var(--radius-selector);
    overflow-y: auto;
    z-index: 1000;
    text-align: right;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
}
.asearch.show {
    display: block;
}
.asearch .item {
    margin-bottom: 0.25em;
    max-height: 5em;
    overflow: hidden;
    width: 100%;
    color: var(--color-base-content);
}
.asearch .item div {
    width: 100%;
}
.asearch .item a {
    display: flex;
    flex-direction: row;
    padding: 0.25em 0.5em;
    text-decoration: none;
    color: inherit;
}
.asearch .item:hover,
.asearch .item.focused {
    background: var(--color-base-200);
    outline: 1px solid var(--color-base-300);
}
.asearch .item img {
    width: 2.25em;
    height: 2.25em;
    border-radius: 3px;
    margin-top: 0.25em;
    margin-right: 0.5em;
}
.asearch .item h4 {
    margin: 0;
    font-size: 0.8em;
    font-weight: 500;
    text-align: left;
    padding: 0;
}
.asearch .item h4 p {
    margin-top: -0.25em;
    font-size: 1em;
    text-align: right;
}
.asearch .item p {
    font-size: 0.8em;
    color: grey;
    text-align: left;
    margin: 0;
}
.asearch .no-results {
    padding: 0.5em;
    color: var(--color-muted);
    text-align: left;
    font-size: 0.9em;
}
.asearch > * .sale {
    color:red;
}
.asearch > * i {
    font-size: 0.8em;
    color: grey;
    text-decoration: line-through;
    text-align: right;
}
.asearch > * strong {
    font-size: 0.8em;
    color: grey;
    margin-left: 1em;
    margin-bottom: 1em;
}
`)

class AutoSearch extends HTMLElement {
    options = {
        source      : "/search",            // search endpoint
    	notfound	: "",                   // not found message
    	handle      : "",                   // search handle
    	delay       : 250,         	        // search delay in ms
        chars       : 3,                    // input threshold
        include     : ["products", "articles", "pages"],
        filter      : ["title", "image", "lang", "currency", "featured_image", "meta.description", "price", "compare_at_price"],
        limit       : 10,
        truncate    : 100,
        lang        : '',
        currency    : '',
    }
    #q = {                                  // search query
        query: "",
        include: [],
        filter: [],
        limit: 0,
        handle: "",
        lang: "",
        currency: "",
    }
    #timer
    #visible = false
    #target
    #el
    #shadow
    #selectedIndex = -1
    #items = []
    #itemsNodes = []
    #currency = {}

    connectedCallback() {
        this.classList.add("asearch-wrapper");

        // create shadow root
        this.#shadow = this.attachShadow({ mode: "open" });
        
        // add styles to shadow DOM
        if (this.#shadow.adoptedStyleSheets) {
            this.#shadow.adoptedStyleSheets = [searchCSS];
        } else {
            const style = document.createElement("style");
            style.textContent = searchCSS.cssText;
            this.#shadow.appendChild(style);
        }


        // create slot for light DOM content (input field)
        const slot = document.createElement('slot');
        this.#shadow.appendChild(slot);

        // apply configuration through attributes
        let intVal = 0;
        for(const [i,a] of Object.entries(Array.from(this.attributes))) {
            if(this.options.hasOwnProperty(a.name)) {
                switch(a.name) {
                    case "include":
                    case "filter":
                        if(a.value) {
                            this.options[a.name] = a.value.split(",").map(m => m.trim());
                        }
                        break;
                    case "delay":
                    case "chars":
                    case "limit":
                    case "truncate":
                        intVal = parseInt(a.value);
                        if(!Number.isNaN(intVal)) {
                            this.options[a.name] = intVal;
                        }
                        break;
                    default:
                        this.options[a.name] = a.value;
                        break;
                }
            }
        }

        // input is in light DOM, query it
        this.#target = this.querySelector("input");
        if(!this.#target) {
            console.error("AutoSearch: No input element found");
            return;
        }

        this.#target.addEventListener("input", ev => this.#input(ev));
        this.#target.addEventListener("keydown", ev => this.#keyDown(ev));

        let include = this.querySelector('[name="include"]');
        if(include) {
            if(include.value) {
                this.options.include = include.value.split(",");
            }
            include.addEventListener("change",  x => {
                if(!x.target.value) {
                    this.#q.include = this.options.include;
                } else {
                    this.#q.include = x.target.value.split(",");
                }
                if(this.#q.query) {
                    this.#input();
                }
            });
        }
        this.#q.include = this.options.include;
        this.#q.filter = this.options.filter;
        this.#q.limit = this.options.limit;
        this.#q.handle = this.options.handle;
        this.#q.lang = this.options.lang;
        this.#q.currency = this.options.currency;

        // setup result listing element inside shadow
        let el = document.createElement("div");
        el.className = "asearch";
        el.setAttribute("role", "listbox");
        el.style.top = this.#target.getBoundingClientRect().height + "px";
        this.#shadow.appendChild(el);
        this.#el = el;
    }

    toggle(state) {
        state = state != undefined ? state : !this.#visible;
        this.#visible = state;
        let el = this.#el;

        if(this.#visible) {
            el.classList.add("show");

            // close on outside click handler
            if(typeof this.boundClose !== "function") {
                this.boundClose = ev => this.outsideClose(ev);
            }
            
            document.addEventListener("click", this.boundClose)
        } else {
            el.classList.remove("show");
            document.removeEventListener('click', this.boundClose);
        }
    }

    outsideClose(ev) {
        // check if click is outside the component
        if (!this.contains(ev.target)) {
            this.toggle(false);
        }
    }

    #input(ev) {
        let search = this.#target.value;

        if(search.length >= this.options.chars){
            this.performSearch(search);
            this.toggle(true);
        } else {
            this.toggle(false);
            this.#el.innerHTML = "";
        }
    }

    performSearch(query){
        if(this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }

        this.#timer = setTimeout(() => {
            this.search(query);
        }, this.options.delay);
    }

    search(query){
        let self = this;
        this.#q.query = query;
        
        return fetch(this.options.source, {
            method: "POST",
            body: JSON.stringify(this.#q),
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        }).then(res => {
            if(!res.ok) throw new Error(`Search request failed: ${res.status} ${res.statusText}`);
            
            return res.json();
        }).then(res => {
            let data = {};
            for(const k of this.#q.include) {
                data[k] = res[k];
            }
            self.results(data, query);
        }).catch(err => {
            console.error("Search error:", err);
        });
    }

    results(data, key){
        let content = "";
        let count = 0;
        this.#items = [];

        for(const [t,v] of Object.entries(data)){
            if(Array.isArray(v)) {
                for(var i = 0, l = v.length; i < l; i++){
                    if(typeof v[i] === 'object'){
                        content+= this.format(v[i], t);
                        // store minimal item meta for navigation
                        this.#items.push({type: t, item: v[i]});
                        count++;
                    }
                }
            }
        }

        if(!content && this.options.notfound) {
            content = `<div class="no-results" role="status" aria-live="polite">${this.options.notfound}</div>`;
            this.#items = [];
            this.#selectedIndex = -1;
        }

        this.#el.innerHTML = content;

        // mouse navigation for items
        const nodes = Array.from(this.#el.querySelectorAll('.item'));
        this.#itemsNodes = nodes;
        
        nodes.forEach((n, idx) => {
            n.addEventListener('pointerover', () => this.#setSelection(idx));
        });

        // reset selection
        this.#selectedIndex = -1;
    }

    format(item, t){
        let h = "";
        let title = item.title || "";

        let price = (item.price && parseFloat(item.price)) || 0;
        let compareAtPrice = (item.compareAtPrice && parseFloat(item.compareAtPrice)) || 0;
        let onSale = compareAtPrice > price;

        let src = "";
        if(item.featuredImage?.src) src = item.featuredImage.src;
        else if(item.featured_image?.src) src = item.featured_image.src;
        else if(item.image?.src) src = item.image.src;

        h+= `<div class="item" role="option" aria-selected="false">`;
        h+= `<a href="${item.url || '#'}" ${!item.url ? 'aria-disabled="true"':''}>`;

        if(src) {
            let d = src.lastIndexOf('.');
            if(d > 0) {
                src = src.slice(0,d) + "_50_50" + src.slice(d);
            }
            h+= `<img src="/media/${t.slice(0,-1)}/${item.id}/${src}" alt="${title}">`;
        }

        h += `<div><h4>${title}`;
        if(t === "products") {
            h += "<p>";
            if(onSale && compareAtPrice) {
                let cp = this.money(item, compareAtPrice);  
                h+= `<i>${cp}</i>`;                                
            }
            if(price) {
                let pp = this.money(item, price);
                h+= `<strong class="${(onSale ? 'sale' : '')}">${pp}</strong>`;
            }
            h += "</p>";
        }
        h += "</h4>";

        if(item.meta && item.meta.description) {
            h+= `<p>${item.meta.description}</p>`;
        }
        h += "</div></a></div>";

        return h;
    }

    money(item, value) {
        const currency = this.currency(item.lang, item.currency);
        return currency.format(value / 1000);
    }

    currency(l, c) {
        l = l || this.#q.lang;
        c = c || this.#q.currency;
        let key = l+c;
        if(this.#currency[key]) return this.#currency[key];
        
        let conf = {
            style: 'currency',
            currency: c,
            currencyDisplay: "narrowSymbol"
        };
        
        this.#currency[key] = new Intl.NumberFormat(l, conf); 
        
        return this.#currency[key];
    }

    #setSelection(idx) {
        if(!this.#itemsNodes?.length) return;
        if(idx < 0) idx = 0;
        if(idx >= this.#itemsNodes.length) idx = this.#itemsNodes.length - 1;

        // remove previous selection
        if(this.#selectedIndex >= 0 && this.#itemsNodes[this.#selectedIndex]) {
            this.#itemsNodes[this.#selectedIndex].classList.remove('focused');
            this.#itemsNodes[this.#selectedIndex].setAttribute('aria-selected', 'false');
        }

        this.#selectedIndex = idx;

        const node = this.#itemsNodes[idx];
        if(node) {
            node.classList.add('focused');
            node.setAttribute('aria-selected', 'true');
            node.scrollIntoView({block: "nearest"});
        }
    }

    #clearSelection() {
        if(this.#selectedIndex >= 0 && this.#itemsNodes && this.#itemsNodes[this.#selectedIndex]) {
            this.#itemsNodes[this.#selectedIndex].classList.remove('focused');
            this.#itemsNodes[this.#selectedIndex].setAttribute('aria-selected', 'false');
        }
        this.#selectedIndex = -1;
    }

    #keyDown(ev) {
        if(!this.#el || !this.#el.classList.contains('show')) return;

        switch(ev.key) {
            case "ArrowDown":
                ev.preventDefault();
                if(!this.#itemsNodes?.length) return;
                if(this.#selectedIndex < 0) this.#setSelection(0);
                else this.#setSelection(this.#selectedIndex + 1);
                break;
            case "ArrowUp":
                ev.preventDefault();
                if(!this.#itemsNodes?.length) return;
                if(this.#selectedIndex < 0) this.#setSelection(this.#itemsNodes.length - 1);
                else this.#setSelection(this.#selectedIndex - 1);
                break;
            case "Enter":
                if(this.#selectedIndex < 0) return;
                if(this.#itemsNodes && this.#itemsNodes[this.#selectedIndex]) {
                    const a = this.#itemsNodes[this.#selectedIndex].querySelector('a');
                    if(a && a.href && a.getAttribute('aria-disabled') !== 'true') {
                        window.location.href = a.href;
                    }
                }
                break;
            case "Escape":
                this.toggle(false);
                break;
        }
    }
}

customElements.define('a-search', AutoSearch);