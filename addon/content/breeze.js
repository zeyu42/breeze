/* global Zotero, Services */
/* eslint-disable no-unused-vars */

// Main Breeze module — loaded via Services.scriptloader.loadSubScript() in bootstrap.js
// Mounted on Zotero.Breeze so it's accessible from isolated pref pane scope (Zotero 8+).

Zotero.Breeze = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],
    registeredNotifierID: null,
    filterCache: {},       // { feedURL_hash: { relevant: [guid, …], ts: epoch } }
    _filterActive: false,  // per-session toggle state
    _originalRows: null,   // saved itemsView reference when filter is on
    _statusLog: [],        // array of {ts, message} for the pref pane log
    _lastRequest: null,    // last full LLM request (system + user prompt) for saving

    // ─── Lifecycle ───────────────────────────────────────────────

    init({ id, version, rootURI }) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        this.initialized = true;
        this.loadCacheFromDisk();
    },

    log(msg) {
        Zotero.debug("Breeze: " + msg);
        this.appendLog(msg);
    },

    appendLog(msg) {
        let entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this._statusLog.push(entry);
        // Keep last 200 lines
        if (this._statusLog.length > 200) {
            this._statusLog = this._statusLog.slice(-200);
        }
    },

    getLogText() {
        return this._statusLog.join('\n');
    },

    // ─── Preferences helpers ─────────────────────────────────────

    getPref(key) {
        return Zotero.Prefs.get("extensions.breeze." + key, true);
    },

    setPref(key, value) {
        Zotero.Prefs.set("extensions.breeze." + key, value, true);
    },

    // ─── Window management (following Make It Red pattern) ───────

    addToWindow(window) {
        let doc = window.document;

        // Load Fluent localization
        window.MozXULElement.insertFTLIfNeeded("breeze.ftl");

        // Add stylesheet
        let link = doc.createElement('link');
        link.id = 'breeze-stylesheet';
        link.type = 'text/css';
        link.rel = 'stylesheet';
        link.href = this.rootURI + 'content/breeze.css';
        doc.documentElement.appendChild(link);
        this.storeAddedElement(link);

        // ── Tools menu items ──
        let menuPopup = doc.getElementById('menu_ToolsPopup');

        let sep = doc.createXULElement('menuseparator');
        sep.id = 'breeze-tools-sep';
        menuPopup.appendChild(sep);
        this.storeAddedElement(sep);

        let menuSummarize = doc.createXULElement('menuitem');
        menuSummarize.id = 'breeze-menu-summarize';
        menuSummarize.setAttribute('data-l10n-id', 'breeze-menu-summarize');
        menuSummarize.addEventListener('command', () => {
            Zotero.Breeze.runSummarize(window);
        });
        menuPopup.appendChild(menuSummarize);
        this.storeAddedElement(menuSummarize);

        let menuShowInterest = doc.createXULElement('menuitem');
        menuShowInterest.id = 'breeze-menu-show-interest';
        menuShowInterest.setAttribute('data-l10n-id', 'breeze-menu-show-interest');
        menuShowInterest.addEventListener('command', () => {
            Zotero.Breeze.showInterestDialog(window);
        });
        menuPopup.appendChild(menuShowInterest);
        this.storeAddedElement(menuShowInterest);

        // ── Filter toggle button in toolbar ──
        let toolbar = doc.getElementById('zotero-items-toolbar');
        if (toolbar) {
            let filterBtn = doc.createXULElement('toolbarbutton');
            filterBtn.id = 'breeze-filter-toggle';
            filterBtn.setAttribute('label', 'Breeze Filter');
            filterBtn.setAttribute('tooltiptext', 'Toggle to show only articles matching your research interests');
            filterBtn.setAttribute('type', 'checkbox');
            filterBtn.classList.add('breeze-filter-btn');
            filterBtn.style.minWidth = '90px';
            filterBtn.addEventListener('command', () => {
                Zotero.Breeze.toggleFilter(window);
            });
            toolbar.appendChild(filterBtn);
            this.storeAddedElement(filterBtn);
        }

        // Auto-deactivate filter when switching collections
        // Monkey-patch ZoteroPane.onCollectionSelected — this is the ONLY reliable
        // hook in Zotero 7/8 since the collections tree is a custom element
        let zp = window.ZoteroPane;
        if (zp && !zp._breezeOrigOnCollectionSelected) {
            zp._breezeOrigOnCollectionSelected = zp.onCollectionSelected.bind(zp);
            zp.onCollectionSelected = async function (...args) {
                // Deactivate filter before the collection switch completes
                if (Zotero.Breeze._filterActive) {
                    Zotero.Breeze._filterActive = false;
                    Zotero.Breeze._updateFilterButtonState();
                    Zotero.Breeze.log('Filter auto-deactivated due to folder switch');
                }
                return zp._breezeOrigOnCollectionSelected(...args);
            };
        }
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) {
            throw new Error("Element must have an id");
        }
        this.addedElementIDs.push(elem.id);
    },

    removeFromWindow(window) {
        var doc = window.document;
        for (let id of this.addedElementIDs) {
            doc.getElementById(id)?.remove();
        }
        // Restore original onCollectionSelected
        let zp = window.ZoteroPane;
        if (zp && zp._breezeOrigOnCollectionSelected) {
            zp.onCollectionSelected = zp._breezeOrigOnCollectionSelected;
            delete zp._breezeOrigOnCollectionSelected;
        }
        // Remove Fluent link
        let ftl = doc.querySelector('[href="breeze.ftl"]');
        if (ftl) ftl.remove();
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
        if (this.registeredNotifierID) {
            Zotero.Notifier.unregisterObserver(this.registeredNotifierID);
            this.registeredNotifierID = null;
        }
    },

    _updateFilterButtonState() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            let btn = win.document.getElementById('breeze-filter-toggle');
            if (btn) {
                btn.checked = this._filterActive;
            }
        }
    },

    // ─── Helper: check if current view is a feed context ─────────

    _isFeedContext(collectionTreeRow) {
        if (!collectionTreeRow) return false;
        // Individual feed
        if (typeof collectionTreeRow.isFeed === 'function' && collectionTreeRow.isFeed()) return true;
        // Aggregate "Feeds" header (all feeds)
        if (typeof collectionTreeRow.isFeeds === 'function' && collectionTreeRow.isFeeds()) return true;
        return false;
    },

    // ─── Interest Summarization ──────────────────────────────────

    async runSummarize(window) {
        let apiKey = this.getPref('apiKey');
        if (!apiKey) {
            this.showAlert(window, await this.getL10nString(window, 'breeze-status-no-api-key'));
            return;
        }

        try {
            this.log('Starting research interest summarization...');
            this.showProgressWindow(window, await this.getL10nString(window, 'breeze-status-summarizing'));

            // 1. Get all regular items from user library
            let libraryID = Zotero.Libraries.userLibraryID;
            let items = await Zotero.Items.getAll(libraryID);

            // Filter to regular items only (not notes, attachments)
            let regularItems = items.filter(item => {
                try {
                    return item.isRegularItem();
                } catch (e) {
                    return false;
                }
            });

            this.log(`Found ${regularItems.length} regular items in library`);

            if (regularItems.length === 0) {
                this.showAlert(window, "No items found in your library to analyze.");
                return;
            }

            // 2. Sample titles (nested sampling: sampled abstracts ⊂ sampled titles ⊂ all papers)
            let titleSampleRate = (this.getPref('titleSampleRate') || 50) / 100;
            let abstractSampleRate = (this.getPref('abstractSampleRate') || 30) / 100;

            let allTitles = regularItems.map(item => {
                try { return item.getField('title'); }
                catch (e) { return ''; }
            }).filter(t => t);

            // Sample titles
            let sampledItems = regularItems.filter(() => Math.random() < titleSampleRate);
            let sampledTitles = sampledItems.map(item => {
                try { return item.getField('title'); }
                catch (e) { return ''; }
            }).filter(t => t);

            // 3. Sample abstracts from the sampled titles
            let abstracts = [];
            for (let item of sampledItems) {
                if (Math.random() < abstractSampleRate) {
                    try {
                        let abs = item.getField('abstractNote');
                        if (abs && abs.trim()) {
                            let title = item.getField('title') || 'Untitled';
                            abstracts.push({ title, abstract: abs.trim() });
                        }
                    } catch (e) {
                        // Some items may not have abstractNote field
                    }
                }
            }

            this.log(`Library: ${allTitles.length} total papers`);
            this.log(`Sampled titles: ${sampledTitles.length} (${Math.round(titleSampleRate * 100)}%)`);
            this.log(`Sampled abstracts: ${abstracts.length} (${Math.round(abstractSampleRate * 100)}% of sampled titles)`);

            // 4. Build library collection tree
            let libraryTree = await this.buildLibraryTree(libraryID);
            this.log(`Library tree:\n${libraryTree}`);

            // 5. Build prompt
            let systemPrompt = `You are an expert academic research analyst. Your task is to analyze the contents of a researcher's reference library and produce a structured summary of their research interests. Be thorough and specific. Use terms and short phrases, NOT full sentences.`;

            let titlesText = sampledTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');

            let abstractsText = '';
            if (abstracts.length > 0) {
                abstractsText = '\n\nSampled Abstracts:\n' +
                    abstracts.map(a => `--- ${a.title} ---\n${a.abstract}`).join('\n\n');
            }

            let userPrompt = `This researcher's Zotero library contains ${allTitles.length} papers total.\n\n` +
                `=== LIBRARY STRUCTURE ===\n${libraryTree}\n=========================\n\n` +
                `Below is a random sample of ${sampledTitles.length} paper titles` +
                (abstracts.length > 0 ? ` and ${abstracts.length} sampled abstracts` : '') + `.\n\n` +
                `Sampled Paper Titles:\n${titlesText}` +
                abstractsText +
                `\n\n=== LIBRARY STRUCTURE (repeated for reference) ===\n${libraryTree}\n=========================\n\n` +
                `Based on the library structure, sampled titles, and sampled abstracts above, summarize this researcher's research interests using ONLY the following structured format. ` +
                `For each field, list as many relevant terms or short phrases as appropriate. Use terms, NOT full sentences.\n\n` +
                `Topics:\nMethods:\nTheoretical frameworks:\nApplication domains:\nInterdisciplinary connections:`;

            let estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
            this.log(`Final prompt: ${userPrompt.length} chars, ~${estimatedTokens} tokens`);

            // 6. Save the full request for debugging/export
            this._lastRequest = `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== USER PROMPT ===\n${userPrompt}`;

            // 7. Call LLM
            this.log('Sending prompt to LLM (' + (this.getPref('model') || 'gpt-4o-mini') + ')...');
            let summary = await this.callLLM(systemPrompt, userPrompt);

            // 8. Save result
            this.setPref('researchInterest', summary);
            this.setPref('lastSummarized', new Date().toISOString());

            this.log('Interest summarization complete. Summary length: ' + summary.length + ' chars');
            this.log('LLM Response:\n' + summary);
            this.showInterestDialog(window);

        } catch (e) {
            this.log('ERROR during summarization: ' + e.message);
            if (e.stack) this.log('Stack: ' + e.stack);
            this.showAlert(window, 'Error: ' + e.message);
        }
    },

    async checkScheduledSummarization() {
        let schedule = this.getPref('schedule');
        if (schedule !== 'monthly') return;

        let lastStr = this.getPref('lastSummarized');
        if (!lastStr) return; // Never run; user should run manually first

        let last = new Date(lastStr);
        let now = new Date();
        let diffDays = (now - last) / (1000 * 60 * 60 * 24);

        if (diffDays >= 30) {
            this.log("Monthly summarization is due — running in background");
            let win = Services.wm.getMostRecentWindow("navigator:browser");
            if (win) {
                await this.runSummarize(win);
            }
        }
    },

    // ─── Feed Article Filtering ──────────────────────────────────

    async toggleFilter(window) {
        this._filterActive = !this._filterActive;
        this._updateFilterButtonState();

        let zp = window.ZoteroPane;
        if (!zp) return;

        let collectionTreeRow = zp.getCollectionTreeRow();
        if (!this._isFeedContext(collectionTreeRow)) {
            this._filterActive = false;
            this._updateFilterButtonState();
            this.showAlert(window, "Breeze filter is only available when viewing an RSS feed.");
            return;
        }

        if (this._filterActive) {
            await this.applyFilter(window);
        } else {
            this.clearFilter(window);
        }
    },

    async applyFilter(window) {
        let interest = this.getPref('researchInterest');
        if (!interest) {
            this._filterActive = false;
            this._updateFilterButtonState();
            this.showAlert(window, await this.getL10nString(window, 'breeze-status-no-interest'));
            return;
        }

        let apiKey = this.getPref('apiKey');
        if (!apiKey) {
            this._filterActive = false;
            this._updateFilterButtonState();
            this.showAlert(window, await this.getL10nString(window, 'breeze-status-no-api-key'));
            return;
        }

        let zp = window.ZoteroPane;
        let collectionTreeRow = zp.getCollectionTreeRow();

        // Collect feed items — handle individual feed vs aggregate Feeds view
        let feedItems = [];
        let cacheKeyBase = '';

        if (typeof collectionTreeRow.isFeed === 'function' && collectionTreeRow.isFeed()) {
            // Individual feed
            let feed = Zotero.Feeds.get(collectionTreeRow.ref.libraryID);
            if (!feed) return;
            cacheKeyBase = feed.url;
            let allItems = await Zotero.Items.getAll(feed.libraryID);
            feedItems = allItems.filter(item => {
                try { return item.isFeedItem; } catch (e) { return false; }
            });
        } else {
            // Aggregate "Feeds" view — collect from all feeds
            cacheKeyBase = 'all_feeds';
            let feeds = Zotero.Feeds.getAll();
            for (let feed of feeds) {
                try {
                    let allItems = await Zotero.Items.getAll(feed.libraryID);
                    let items = allItems.filter(item => {
                        try { return item.isFeedItem; } catch (e) { return false; }
                    });
                    feedItems = feedItems.concat(items);
                } catch (e) {
                    this.log('Error reading feed: ' + e.message);
                }
            }
        }

        if (feedItems.length === 0) {
            this.showAlert(window, "No feed items found.");
            this._filterActive = false;
            this._updateFilterButtonState();
            return;
        }

        // Build cache key
        let contentForHash = feedItems.map(item => {
            try { return item.getField('title'); } catch (e) { return ''; }
        }).sort().join('|');
        let cacheKey = cacheKeyBase + '_' + this.simpleHash(contentForHash);

        // Check cache
        let cached = this.filterCache[cacheKey];
        if (cached) {
            this.log("Using cached filter results");
            this.applyFilterToView(window, cached.relevant, feedItems);
            return;
        }

        // Call LLM to filter
        try {
            this.showProgressWindow(window, await this.getL10nString(window, 'breeze-status-filtering'));

            let itemDescriptions = feedItems.map(item => {
                let title = '';
                let abstract = '';
                try { title = item.getField('title'); } catch (e) { /* no title */ }
                try { abstract = item.getField('abstractNote'); } catch (e) { /* no abstract */ }
                let id = item.id;
                return { id, title, abstract };
            }).filter(d => d.title);

            let itemsText = itemDescriptions.map((d, i) => {
                let entry = `[${d.id}] ${d.title}`;
                if (d.abstract) entry += `\n   Abstract: ${d.abstract}`;
                return entry;
            }).join('\n\n');

            let systemPrompt = `You are a research article recommender. Given a researcher's interest profile and a list of articles from a journal RSS feed, determine which articles are relevant to the researcher's interests.\n\nRespond ONLY with a JSON array of article IDs (the numbers in square brackets) that are relevant. Example: [123, 456, 789]\n\nBe inclusive rather than exclusive — if an article is even peripherally related to the researcher's interests, include it.`;

            let userPrompt = `Researcher's Interest Profile:\n${interest}\n\n---\n\nArticles to evaluate:\n${itemsText}\n\n---\n\nReturn ONLY a JSON array of relevant article IDs:`;

            let response = await this.callLLM(systemPrompt, userPrompt);

            // Parse response — extract JSON array
            let relevantIds;
            try {
                // Try to extract JSON array from the response
                let match = response.match(/\[[\s\S]*?\]/);
                if (match) {
                    relevantIds = JSON.parse(match[0]);
                } else {
                    throw new Error("No JSON array in response");
                }
            } catch (e) {
                this.log("Failed to parse LLM response: " + response);
                this.showAlert(window, "Error parsing LLM response. Please try again.");
                this._filterActive = false;
                this._updateFilterButtonState();
                return;
            }

            // Cache results
            this.filterCache[cacheKey] = {
                relevant: relevantIds,
                ts: Date.now()
            };
            this.saveCacheToDisk();

            this.applyFilterToView(window, relevantIds, feedItems);

        } catch (e) {
            this.log("Error during filtering: " + e.message);
            this.showAlert(window, "Error: " + e.message);
            this._filterActive = false;
            this._updateFilterButtonState();
        }
    },

    applyFilterToView(window, relevantIds, feedItems) {
        let zp = window.ZoteroPane;
        if (!zp || !zp.itemsView) return;

        let relevantSet = new Set(relevantIds.map(id => Number(id)));
        let itemsView = zp.itemsView;

        if (itemsView._rows && Array.isArray(itemsView._rows)) {
            // Save original rows BEFORE splicing so we can restore on clear
            window._breezeOrigRows = [...itemsView._rows];

            let removedCount = 0;
            for (let i = itemsView._rows.length - 1; i >= 0; i--) {
                try {
                    let row = itemsView._rows[i];
                    let item = row.ref || row;
                    if (!relevantSet.has(item.id)) {
                        itemsView._rows.splice(i, 1);
                        removedCount++;
                    }
                } catch (e) { /* skip */ }
            }

            // Refresh the virtual tree
            itemsView._rowCache = {};
            if (itemsView.tree) {
                itemsView.tree.invalidate();
            }

            this.log(`Filter applied: removed ${removedCount} items, showing ${itemsView._rows.length} relevant items`);
        } else {
            this.log('Warning: could not access itemsView._rows — filter may not work');
        }
    },

    async clearFilter(window) {
        let zp = window.ZoteroPane;
        if (!zp) return;

        this._filterActive = false;
        this._updateFilterButtonState();

        // Restore saved rows directly — much more reliable than re-selecting
        // the same collection (which Zotero optimizes away as a no-op)
        let itemsView = zp.itemsView;
        if (window._breezeOrigRows && itemsView && itemsView._rows) {
            itemsView._rows = window._breezeOrigRows;
            window._breezeOrigRows = null;
            itemsView._rowCache = {};
            if (itemsView.tree) {
                itemsView.tree.invalidate();
            }
            this.log('Filter cleared — restored original rows');
        } else {
            this.log('No saved rows to restore');
        }

        this.log("Filter cleared");
    },

    // ─── LLM API ─────────────────────────────────────────────────

    async callLLM(systemPrompt, userPrompt) {
        let apiUrl = this.getPref('apiUrl') || 'https://api.openai.com/v1';
        let apiKey = this.getPref('apiKey');
        let model = this.getPref('model') || 'gpt-4o-mini';

        if (!apiKey) {
            throw new Error("API key not configured. Set it in Breeze preferences.");
        }

        // Ensure URL ends properly
        let chatUrl = apiUrl.replace(/\/+$/, '') + '/chat/completions';

        let body = JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 2000
        });

        this.log('Calling LLM API: ' + chatUrl);
        this.log('Model: ' + model + ', Prompt length: ' + userPrompt.length + ' chars');

        let response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: body
        });

        if (!response.ok) {
            let errorText = await response.text();
            this.log('API Error (' + response.status + '): ' + errorText);
            throw new Error('API request failed (' + response.status + '): ' + errorText);
        }

        let data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error("Unexpected API response format");
        }

        let result = data.choices[0].message.content.trim();
        this.log('LLM response received. Length: ' + result.length + ' chars');
        return result;
    },

    // ─── Cache persistence ───────────────────────────────────────

    getCacheDir() {
        let dir = PathUtils.join(Zotero.DataDirectory.dir, 'breeze');
        return dir;
    },

    async ensureCacheDir() {
        let dir = this.getCacheDir();
        if (!(await IOUtils.exists(dir))) {
            await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        }
        return dir;
    },

    async loadCacheFromDisk() {
        try {
            let dir = this.getCacheDir();
            let cacheFile = PathUtils.join(dir, 'filter_cache.json');
            if (await IOUtils.exists(cacheFile)) {
                let content = await IOUtils.readUTF8(cacheFile);
                this.filterCache = JSON.parse(content);
                this.log("Loaded filter cache from disk");
            }
        } catch (e) {
            this.log("Error loading cache: " + e.message);
            this.filterCache = {};
        }
    },

    async saveCacheToDisk() {
        try {
            let dir = await this.ensureCacheDir();
            let cacheFile = PathUtils.join(dir, 'filter_cache.json');
            await IOUtils.writeUTF8(cacheFile, JSON.stringify(this.filterCache, null, 2));
            this.log("Saved filter cache to disk");
        } catch (e) {
            this.log("Error saving cache: " + e.message);
        }
    },

    // ─── UI Helpers ──────────────────────────────────────────────

    showAlert(window, message) {
        Services.prompt.alert(window, "Breeze", message);
    },

    showProgressWindow(window, message) {
        // Use Zotero's built-in progress window
        try {
            let pw = new Zotero.ProgressWindow({ closeOnClick: false });
            pw.changeHeadline("Breeze");
            pw.addDescription(message);
            pw.show();
            // Auto-close after 3 seconds
            pw.startCloseTimer(3000);
        } catch (e) {
            this.log("Progress window error: " + e.message);
        }
    },

    async showInterestDialog(window) {
        let interest = this.getPref('researchInterest');
        let lastUpdated = this.getPref('lastSummarized');

        if (!interest) {
            this.showAlert(window, "No research interest summary yet. Use Tools → Summarize Research Interests first.");
            return;
        }

        let dateStr = lastUpdated ? new Date(lastUpdated).toLocaleDateString() : 'Unknown';

        // Show a dialog with the interest summary
        let message = `Last updated: ${dateStr}\n\n${interest}`;

        Services.prompt.alert(window, "Research Interest Summary — Breeze", message);
    },

    async getL10nString(window, id, args) {
        try {
            if (window && window.document && window.document.l10n) {
                return await window.document.l10n.formatValue(id, args || {});
            }
        } catch (e) {
            // Fallback
        }
        // Fallback to id itself
        return id;
    },

    // ─── Library Tree ────────────────────────────────────────────

    async buildLibraryTree(libraryID) {
        try {
            let collections = Zotero.Collections.getByLibrary(libraryID, true);
            if (!collections || collections.length === 0) {
                return 'My Library\n  (no collections)';
            }

            // Build parent→children map
            let childMap = {};   // parentID → [collection, ...]
            let roots = [];

            for (let col of collections) {
                let parentID = col.parentID;
                if (parentID) {
                    if (!childMap[parentID]) childMap[parentID] = [];
                    childMap[parentID].push(col);
                } else {
                    roots.push(col);
                }
            }

            // Sort alphabetically at each level
            let sortFn = (a, b) => (a.name || '').localeCompare(b.name || '');
            roots.sort(sortFn);
            for (let key in childMap) {
                childMap[key].sort(sortFn);
            }

            // Recursive ASCII tree builder
            let lines = ['My Library'];
            let buildSubtree = (children, prefix) => {
                for (let i = 0; i < children.length; i++) {
                    let col = children[i];
                    let isLast = (i === children.length - 1);
                    let connector = isLast ? '└── ' : '├── ';
                    let childPrefix = isLast ? '    ' : '│   ';

                    // Count items in this collection
                    let itemCount = 0;
                    try {
                        let itemIDs = col.getChildItems(false);
                        itemCount = itemIDs ? itemIDs.length : 0;
                    } catch (e) { /* skip */ }

                    let label = col.name || 'Untitled';
                    if (itemCount > 0) {
                        label += ` (${itemCount})`;
                    }
                    lines.push(prefix + connector + label);

                    // Recurse into children
                    let subChildren = childMap[col.id];
                    if (subChildren && subChildren.length > 0) {
                        buildSubtree(subChildren, prefix + childPrefix);
                    }
                }
            };

            buildSubtree(roots, '');
            return lines.join('\n');
        } catch (e) {
            this.log('Error building library tree: ' + e.message);
            return 'My Library\n  (unable to read collections)';
        }
    },

    // ─── Utility ─────────────────────────────────────────────────

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            let chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }
};

// Also keep a local `Breeze` reference for backward compatibility in bootstrap.js scope
Breeze = Zotero.Breeze;
