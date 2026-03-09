/* global Zotero, Services */

// Preferences pane script for Breeze
// Note: In Zotero 8, preference panes run in ISOLATED scope.
// Access the main module via Zotero.Breeze (not bare `Breeze`).

var BreezePreferences = {
    _logTimer: null,

    init() {
        // Populate the interest summary textarea
        let interest = Zotero.Prefs.get('extensions.breeze.researchInterest', true) || '';
        let textarea = document.getElementById('breeze-interest-summary');
        if (textarea) {
            textarea.value = interest;
        }

        // Populate last updated
        let lastUpdated = Zotero.Prefs.get('extensions.breeze.lastSummarized', true) || '';
        let lastLabel = document.getElementById('breeze-last-updated');
        if (lastLabel) {
            if (lastUpdated) {
                lastLabel.value = new Date(lastUpdated).toLocaleString();
            } else {
                lastLabel.value = 'Never';
            }
        }

        // Set version info
        let versionLabel = document.getElementById('breeze-about-version');
        if (versionLabel) {
            versionLabel.value = 'Breeze v1.0.0';
        }

        // Populate the status log
        this.refreshLog();
    },

    async summarizeNow() {
        let win = Services.wm.getMostRecentWindow('navigator:browser');
        if (!win) {
            Services.prompt.alert(null, 'Breeze', 'No Zotero window found.');
            return;
        }

        // Access via Zotero.Breeze (global, survives scope isolation)
        if (Zotero.Breeze && Zotero.Breeze.runSummarize) {
            Zotero.Breeze.appendLog('Summarize Now clicked from preferences pane');

            // Start auto-refreshing the log every second
            this.startLogRefresh();

            try {
                await Zotero.Breeze.runSummarize(win);
            } finally {
                this.stopLogRefresh();
                // Final refresh of everything
                this.init();
            }
        } else {
            Services.prompt.alert(win, 'Breeze',
                'Breeze module not loaded. Please restart Zotero.');
        }
    },

    refreshLog() {
        let logArea = document.getElementById('breeze-status-log');
        if (logArea && Zotero.Breeze) {
            logArea.value = Zotero.Breeze.getLogText();
            // Auto-scroll to bottom
            logArea.scrollTop = logArea.scrollHeight;
        }
    },

    clearLog() {
        if (Zotero.Breeze) {
            Zotero.Breeze._statusLog = [];
        }
        let logArea = document.getElementById('breeze-status-log');
        if (logArea) {
            logArea.value = '';
        }
    },

    startLogRefresh() {
        this.stopLogRefresh();
        this._logTimer = setInterval(() => {
            this.refreshLog();
        }, 500);
    },

    stopLogRefresh() {
        if (this._logTimer) {
            clearInterval(this._logTimer);
            this._logTimer = null;
        }
    }
};

// Expose on window so inline oncommand handlers can access it in Zotero 8's isolated scope
window.BreezePreferences = BreezePreferences;
