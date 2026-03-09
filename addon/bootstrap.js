var Breeze;

function log(msg) {
    Zotero.debug("Breeze: " + msg);
}

function install() {
    log("Installed");
}

async function startup({ id, version, rootURI }) {
    log("Starting " + version);

    // Register preference pane
    Zotero.PreferencePanes.register({
        pluginID: 'breeze@zotero-plugin',
        src: rootURI + 'content/preferences.xhtml',
        scripts: [rootURI + 'content/preferences.js'],
        stylesheets: [rootURI + 'content/preferences.css'],
        image: rootURI + 'content/icons/icon.svg',
        label: 'Breeze',
        l10nFiles: ['breeze.ftl'],
    });

    // Load main modules
    Services.scriptloader.loadSubScript(rootURI + 'content/breeze.js');
    Breeze.init({ id, version, rootURI });
    Breeze.addToAllWindows();

    // Check if periodic summarization is due
    await Breeze.checkScheduledSummarization();
}

function onMainWindowLoad({ window }) {
    Breeze.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    Breeze.removeFromWindow(window);
}

function shutdown() {
    log("Shutting down");
    Breeze.removeFromAllWindows();
    Breeze = undefined;
}

function uninstall() {
    log("Uninstalled");
}
