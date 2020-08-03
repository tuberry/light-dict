// vim:fdm=syntax
// by: tuberry@gtihub
'use strict';

const Main = imports.ui.main;
const BoxPointer = imports.ui.boxpointer;
const { Meta, Shell, Clutter, Gio, GLib, GObject, St, Pango, Gdk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.prefs.Fields;
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

const TRIGGER   = { ICON: 0, KEYBOARD: 1, AUTO: 2 };
const LOGSLEVEL = { NEVER: 0, CLICK: 1, HOVER: 2, ALWAYS: 3 };
const MODIFIERS1 = Clutter.ModifierType.MOD2_MASK | Clutter.ModifierType.CONTROL_MASK;
const MODIFIERS2 = MODIFIERS1 | Clutter.ModifierType.BUTTON1_MASK;

const DictIconBar = GObject.registerClass({
    Signals: {
        'iconbar-signals': { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
    },
}, class DictIconBar extends St.BoxLayout {
    _init() {
        super._init({
            reactive: true,
            visible: false,
            vertical: false,
            track_hover: true,
            style_class: 'light-dict-iconbox',
        });
        Main.layoutManager.addChrome(this);

        this._pageIndex = 1;
        this._iconsBox = [];
        this._visibleBox = [];

        this._loadSettings();
    }

    _loadSettings() {
        this._fetchSettings();
        if(this._tooltips) this._addTooltips();
        this._acommands.forEach(x => this._iconBarMaker(x));
        this._leaveIconBarID = this.connect('leave-event', () => {
            if(this._tooltips) this._iconTooltips.hide();
            this.visible = false;
        });
        this._enterIconBarID = this.connect('enter-event', () => {
            if(this._autohideDelayID) GLib.source_remove(this._autohideDelayID), this._autohideDelayID = 0;
            this.visible = true;
        });

        this._xoffsetId   = gsettings.connect(`changed::${Fields.XOFFSET}`, () => { this._xoffset = gsettings.get_int(Fields.XOFFSET); });
        this._yoffsetId   = gsettings.connect(`changed::${Fields.YOFFSET}`, () => { this._yoffset = gsettings.get_int(Fields.YOFFSET); });
        this._autohideId  = gsettings.connect(`changed::${Fields.AUTOHIDE}`, () => { this._autohide = gsettings.get_uint(Fields.AUTOHIDE); });
        this._pagesizeId  = gsettings.connect(`changed::${Fields.PAGESIZE}`, () => { this._pageIndex = 1; this._pagesize = gsettings.get_uint(Fields.PAGESIZE); });
        this._acommandsId = gsettings.connect(`changed::${Fields.ACOMMANDS}`, () => {
            this._pageIndex = 1;
            this._iconBarEraser();
            this._acommands = gsettings.get_strv(Fields.ACOMMANDS);
            this._acommands.forEach(x => this._iconBarMaker(x));
        });
        this._tooltipsId  = gsettings.connect(`changed::${Fields.TOOLTIPS}`, () => {
            this._tooltips = gsettings.get_boolean(Fields.TOOLTIPS);
            this._tooltips ? this._addTooltips() : this._removeTooltips();
        });
    }

    _fetchSettings() {
        this._xoffset   = gsettings.get_int(Fields.XOFFSET);
        this._yoffset   = gsettings.get_int(Fields.YOFFSET);
        this._autohide  = gsettings.get_uint(Fields.AUTOHIDE);
        this._pagesize  = gsettings.get_uint(Fields.PAGESIZE);
        this._acommands = gsettings.get_strv(Fields.ACOMMANDS);
        this._tooltips  = gsettings.get_boolean(Fields.TOOLTIPS);
    }

    _removeTooltips() {
        Main.layoutManager.uiGroup.remove_actor(this._iconTooltips);
        this._iconTooltips.destroy();
        this._iconTooltips = null;
    }

    _addTooltips() {
        this._iconTooltips = new St.Label({
            visible: false,
            style_class: 'light-dict-tooltips',
        });
        Main.layoutManager.uiGroup.add_actor(this._iconTooltips);
    }

    _updateIconBar() {
        this._iconsBox.forEach(x => x.visible = false);
        if(this._pagesize === 0) {
            this._visibleBox.forEach(x => x.visible = true);
            return;
        }
        let pages = Math.ceil(this._visibleBox.length / this._pagesize);
        if(pages === 1) {
            this._visibleBox.forEach(x => x.visible = true);
            return;
        };
        this._pageIndex = this._pageIndex < 1 ? pages : (this._pageIndex > pages ? 1 : this._pageIndex);
        if(this._pageIndex === pages && this._visibleBox.length % this._pagesize) {
            this._visibleBox.forEach((x, i) => {
                x.visible = i >= this._visibleBox.length - this._pagesize && i < this._visibleBox.length;
            });
        } else {
            this._visibleBox.forEach((x, i) => {
                x.visible = i >= (this._pageIndex - 1)*this._pagesize && i < this._pageIndex*this._pagesize;
            });
        }
    }

    vfunc_scroll_event(scrollEvent) {
        if(this._tooltips) this._iconTooltips.hide();
        if(this._pagesize === 0) return;
        this._visibleBox.forEach(x => x.entered = false);
        switch (scrollEvent.direction) {
        case Clutter.ScrollDirection.UP: this._pageIndex--; break;
        case Clutter.ScrollDirection.DOWN: this._pageIndex++; break;
        }
        this._updateIconBar();
        return Clutter.EVENT_PROPAGATE;
    }

    _show(x, y, fw, text) {
        if(this._xoffset || this._yoffset) {
            this.set_position(Math.round(x + this._xoffset), Math.round(y + this._yoffset));
        } else {
            let [W, H] = this.get_size();
            this.set_position(Math.round(x - W / 2), Math.round(y - H * 1.5));
        }

        this._updateVisible(fw, text);
        this.visible = true;

        if(this._autohideDelayID)
            GLib.source_remove(this._autohideDelayID), this._autohideDelayID = 0;

        this._autohideDelayID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide, () => {
            this.visible = false;
            this._autohideDelayID = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateVisible(fw, text) {
        this._iconsBox.forEach(x => {
            switch((x.hasOwnProperty("regexp") << 1) + x.hasOwnProperty("windows")) {
            case 0: x._visible = true; break;
            case 1: x._visible = x.windows.includes(fw); break;
            case 2: x._visible = RegExp(x.regexp, 'i').test(text); break;
            case 3: x._visible = x.windows.includes(fw) & RegExp(x.regexp, 'i').test(text); break;
            }
        });
        this._visibleBox = this._iconsBox.filter(x => x._visible);
        this._updateIconBar();
    }

    _iconBarMaker(cmds) {
        JSON.parse(cmds).entries.forEach(x => {
            let btn = new St.Button({
                reactive: true,
                track_hover: true,
                style_class: `light-dict-button-${x.icon} light-dict-button`,
            });
            btn.child = new St.Icon({
                icon_name: x.icon,
                fallback_icon_name: 'help',
                style_class: `light-dict-button-icon-${x.icon} light-dict-button-icon`,
            }); // St.Bin.child
            if(x.windows && x.windows.length) btn.windows = x.windows;
            if(x.regexp) btn.regexp = x.regexp;
            btn.onClickID = btn.connect('clicked', (actor, event) => {
                this.visible = false;
                this.emit('iconbar-signals', [x.popup, x.clip, x.type, x.paste].map(x => x ? '1' : '0').join(''), x.command);
                return Clutter.EVENT_PROPAGATE;
            });
            btn.onEnterID = btn.connect('enter-event', () => {
                if(!this._tooltips) return;
                btn.entered = true;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide / 2, () => {
                    if(!btn.entered || !this.visible) return GLib.SOURCE_REMOVE;
                    this._iconTooltips.set_position(global.get_pointer()[0], this.get_position()[1] + this.get_size()[1] + 5);
                    this._iconTooltips.set_text(x.tooltip ? x.tooltip : x.icon);
                    this._iconTooltips.show();
                    return GLib.SOURCE_REMOVE;
                });
            });
            btn.onLeaveID = btn.connect('leave-event', () => {
                if(!this._tooltips) return;
                btn.entered = false;
                this._iconTooltips.hide();
            });
            this._iconsBox.push(btn);
            this.add_child(btn);
        });
    }

    _iconBarEraser() {
        this._iconsBox.forEach(x => {
            if(x.onClickID) x.disconnect(x.onClickID), x.onClickID = undefined;
            if(x.onEnterID) x.disconnect(x.onClickID), x.onEnterID = undefined;
            if(x.onLeaveID) x.disconnect(x.onClickID), x.onLeaveID = undefined;
            x.entered = undefined;
            this.remove_child(x);
            x = null;
        });
        this._iconsBox.length = 0;
        this._visibleBox.length = 0;
    }

    destory() {
        if(this._leaveIconBarID)
            this.disconnect(this._leaveIconBarID), this._leaveIconBarID = 0;
        if(this._enterIconBarID)
            this.disconnect(this._enterIconBarID), this._enterIconBarID = 0;
        if(this._autohideDelayID)
            GLib.source_remove(this._autohideDelayID), this._autohideDelayID = 0;
        for(let x in this)
            if(RegExp(/^_.+Id$/).test(x)) eval(`if(this.%s) gsettings.disconnect(this.%s), this.%s = 0;`.format(x, x, x));
        if(this._tooltips) this._removeTooltips();
        Main.layoutManager.removeChrome(this);
        this._iconBarEraser();
        super.destroy();
    }
});

const DictPanel = GObject.registerClass(
class DictPanel extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.TOP, {
            style_class: 'light-dict-boxpointer',
        });
        Main.layoutManager.addChrome(this);

        this._selection = '';
        this._notFound = false;
        this._scrollable = false;
        this._panelClicked = false;

        this._loadSettings();
    }

    _loadSettings() {
        this._fetchSettings();
        this._buildPopupPanel();
        this._addDummyCursor(this._sensitive);
        this._leavePanelID = this._panelBox.connect('leave-event', this._hide.bind(this));
        this._enterPanelID = this._panelBox.connect('enter-event', (actor, event) => {
            this._panelClicked = false;
            this._panelBox.visible = true;
            if(this._logslevel === LOGSLEVEL.HOVER) this._recordLog();
            if(this._autohideDelayID) GLib.source_remove(this._autohideDelayID), this._autohideDelayID = 0;
        });
        this._clickPanelID = this._panelBox.connect('button-press-event', (actor, event) => {
            if(event.get_button() === 1 && this._ccommand)
                this._ccommand.split('#').forEach(x => this._spawnWithGio(x.replace(/LDWORD/g, GLib.shell_quote(this._selection))));
            switch(event.get_button()*!this._panelClicked) {
            case 1: if(this._logslevel === LOGSLEVEL.CLICK) this._recordLog(); break;
            case 2: this._action.copy(this._panelBox._info.get_text()); break;
            case 3: this._spawnWithGio('gio open ' + this._openurl.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
            }
            if(event.get_button() === 3) this._hide();
            this._panelClicked = true;
        });

        this._triggerId    = gsettings.connect(`changed::${Fields.TRIGGER}`, () => { this._trigger = gsettings.get_uint(Fields.TRIGGER); });
        this._openurlId    = gsettings.connect(`changed::${Fields.OPENURL}`, () => { this._openurl = gsettings.get_string(Fields.OPENURL); });
        this._autohideId   = gsettings.connect(`changed::${Fields.AUTOHIDE}`, () => { this._autohide = gsettings.get_uint(Fields.AUTOHIDE); });
        this._ccommandId   = gsettings.connect(`changed::${Fields.CCOMMAND}`, () => { this._ccommand = gsettings.get_string(Fields.CCOMMAND); });
        this._dcommandId   = gsettings.connect(`changed::${Fields.DCOMMAND}`, () => { this._dcommand = gsettings.get_string(Fields.DCOMMAND); });
        this._logslevelId  = gsettings.connect(`changed::${Fields.LOGSLEVEL}`, () => { this._logslevel = gsettings.get_uint(Fields.LOGSLEVEL); });
        this._hidetitleId  = gsettings.connect(`changed::${Fields.HIDETITLE}`, () => {
            this._hidetitle = gsettings.get_boolean(Fields.HIDETITLE);
            this._panelBox._word.visible = !this._hidetitle;
        });
        this._sensitiveId = gsettings.connect(`changed::${Fields.SENSITIVE}`, () => {
            this._sensitive = gsettings.get_boolean(Fields.SENSITIVE);
            this._removeDummyCursor(!this._sensitive);
            this._addDummyCursor(this._sensitive);
        });
        this._minlinesId = gsettings.connect(`changed::${Fields.MINLINES}`, () => {
            this._minlines = gsettings.get_uint(Fields.MINLINES);
            if(this._minlines == 0 && this._scrollable) this._toggleScroll(false);
        });
    }

    _fetchSettings() {
        this._trigger   = gsettings.get_uint(Fields.TRIGGER);
        this._autohide  = gsettings.get_uint(Fields.AUTOHIDE);
        this._logslevel = gsettings.get_uint(Fields.LOGSLEVEL);
        this._openurl   = gsettings.get_string(Fields.OPENURL);
        this._ccommand  = gsettings.get_string(Fields.CCOMMAND);
        this._dcommand  = gsettings.get_string(Fields.DCOMMAND);
        this._hidetitle = gsettings.get_boolean(Fields.HIDETITLE);
        this._sensitive = gsettings.get_boolean(Fields.SENSITIVE);
        this._minlines  = gsettings.get_uint(Fields.MINLINES);
    }

    _toggleScroll(scroll) {
        if(scroll == this._scrollable || !this._minlines) return;
        if(scroll) {
            this.bin.remove_actor(this._panelBox);
            this._scrollView.add_actor(this._panelBox);
            this.bin.add_actor(this._scrollView);
        } else {
            this.bin.remove_actor(this._scrollView);
            this._scrollView.remove_actor(this._panelBox);
            this.bin.add_actor(this._panelBox);
        }
        this._scrollable = scroll;
    }

    _buildPopupPanel() {
        this._scrollView = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            style_class: 'light-dict-scroll',
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC); // St.PolicyType.EXTERNAL);

        this._panelBox = new St.BoxLayout({
            reactive: true,
            vertical: true,
            visible: false,
            style_class: 'light-dict-content',
        });

        this._panelBox._word = new St.Label({style_class: 'light-dict-word', visible: !this._hidetitle});
        this._panelBox._word.clutter_text.line_wrap = true;
        this._panelBox._word.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
        this._panelBox._word.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._panelBox.add_child(this._panelBox._word);

        this._panelBox._info = new St.Label({style_class: 'light-dict-info'});
        this._panelBox._info.clutter_text.line_wrap = true;
        this._panelBox._info.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
        this._panelBox._info.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._panelBox.add_child(this._panelBox._info);

        this.bin.add_actor(this._panelBox);
    }

    _addDummyCursor(sen) {
        this._dummyCursor = new St.Widget({ opacity: 0, reactive: true });
        this._dummyCursor.set_size(Math.round(40), Math.round(40));
        this.setPosition(this._dummyCursor, 0);
        if(sen) {
            Main.layoutManager.uiGroup.add_actor(this._dummyCursor);
        } else {
            this._scrollID = this._dummyCursor.connect('scroll-event', this._hide.bind(this));
            this._clickID = this._dummyCursor.connect('button-press-event', this._hide.bind(this));
            Main.layoutManager.addChrome(this._dummyCursor);
        }
    }

    _removeDummyCursor(sen) {
        if(sen) {
            Main.layoutManager.uiGroup.remove_actor(this._dummyCursor);
        } else {
            if(this._scrollID)
                this._dummyCursor.disconnect(this._scrollID), this._scrollID = 0;
            if(this._clickID)
                this._dummyCursor.disconnect(this._clickID), this._scrollID = 0;
            Main.layoutManager.removeChrome(this._dummyCursor);
        }
        this._dummyCursor = null;
    }

    _spawnWithGio(rcmd) {
        try {
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', rcmd],
                flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            });
            proc.init(null);
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    _lookUp(text, pointer) {
        let rcmd = this._dcommand.replace(/LDWORD/g, GLib.shell_quote(text));
        let proc = new Gio.Subprocess({
            argv: ['/bin/bash', '-c', 'set -o pipefail;' + rcmd],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                this._notFound = proc.get_exit_status() !== 0;
                this._show(this._notFound ? stderr.trim() : stdout.trim(), text, pointer);
                if(this._logslevel === LOGSLEVEL.ALWAYS) this._recordLog();
            } catch(e) {
                Main.notifyError(Me.metadata.name, e.message);
            }
        });
    }

    _hide() {
        if(!this._panelBox.visible) return;

        this._panelBox.visible = false;
        this.close(BoxPointer.PopupAnimation.FADE);
        this._dummyCursor.set_position(...global.display.get_size());
    }

    _show(info, word, pointer) {
        this._selection = word;

        this._toggleScroll(info.split(/\n/).length > this._minlines);
        if(this._scrollable)
            this._scrollView.vscroll.get_adjustment().set_value(0);

        this._dummyCursor.set_position(...pointer.map(x => x - 20));
        this._panelBox._info.clutter_text.set_markup(info);
        if(this._panelBox._word.visible)
            this._panelBox._word.set_text(word);
        if(!this._panelBox.visible) {
            this._panelBox.visible = true;
            this.open(BoxPointer.PopupAnimation.FADE);
            this.get_parent().set_child_above_sibling(this, null);
        }

        if(this._autohideDelayID)
            GLib.source_remove(this._autohideDelayID);

        this._autohideDelayID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide, () => {
            this._hide();
            this._autohideDelayID = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _recordLog() {
        if(this._trigger == TRIGGER.ICON) return;
        let dateFormat = (fmt, date) => {
            const opt = {
                "Y+": date.getFullYear().toString(),
                "m+": (date.getMonth() + 1).toString(),
                "d+": date.getDate().toString(),
                "H+": date.getHours().toString(),
                "M+": date.getMinutes().toString(),
                "S+": date.getSeconds().toString()
            };
            let ret;
            for(let k in opt) {
                ret = new RegExp("(" + k + ")").exec(fmt);
                if(!ret) continue;
                fmt = fmt.replace(ret[1], (ret[1].length == 1) ? (opt[k]) : (opt[k].padStart(ret[1].length, "0")))
            };
            return fmt;
        }
        let logfile = Gio.file_new_for_path(GLib.get_home_dir() + '/.cache/gnome-shell-extension-light-dict/light-dict.log');
        let log = [dateFormat("YYYY-mm-dd HH:MM:SS", new Date()), this._selection, this._notFound ? 0 : 1].join('\t') + '\n';
        try {
            logfile.append_to(Gio.FileCreateFlags.NONE, null).write(log, null);
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    destory() {
        if(this._autohideDelayID)
            GLib.source_remove(this._autohideDelayID), this._autohideDelayID = 0;
        if(this._enterPanelID)
            this._panelBox.disconnect(this._enterPanelID), this._enterPanelID = 0;
        if(this._leavePanelID)
            this._panelBox.disconnect(this._leavePanelID), this._leavePanelID = 0;
        if(this._clickPanelID)
            this._panelBox.disconnect(this._clickPanelID), this._clickPanelID = 0;
        for(let x in this)
            if(RegExp(/^_.+Id$/).test(x)) eval(`if(this.%s) gsettings.disconnect(this.%s), this.%s = 0;`.format(x, x, x));

        Main.layoutManager.removeChrome(this);
        this._scrollView.destroy();
        this._panelBox.destroy();
        this._removeDummyCursor();
        this._scrollView = null;
        this._panelBox = null;
        super.destroy();
    }
});

const LightDict = GObject.registerClass(
class LightDict extends GObject.Object {
    _init() {
        super._init();

        this._pointer = [];
        this._wmclass = null;
        this._selection = '';
        this._panel = new DictPanel();
        this._action = new DictAction();
        this._iconBar = new DictIconBar();

        this._loadSettings();
    }

    _loadSettings() {
        this._fetchSettings();
        if(this._shortcut) this._addKeyBindings();
        this._spawnWithGio = x => this._panel._spawnWithGio(x);
        this._iconBarID = this._iconBar.connect('iconbar-signals', (area, tag, cmd) => {
            let [popup, clip, type, paste] = Array.from(tag, i => i === '1');
            type ? this._runWithEval(popup, clip, paste, cmd) : this._runWithBash(popup, clip, paste, cmd);
        });
        this._onWindowChangedID = global.display.connect('notify::focus-window', () => {
            this._panel._hide();
            this._iconBar.hide();
            let FW = global.display.get_focus_window();
            this._wmclass = FW ? FW.wm_class : null;
            let wlist = this._appslist === '*' | this._appslist.split('#').includes(this._wmclass);
            if(this._blackwhite ? wlist : !wlist) {
                if(!this._selectionChangedID) this._monitorSelection(this._trigger);
            } else {
                if(this._selectionChangedID)
                    global.display.get_selection().disconnect(this._selectionChangedID), this._selectionChangedID = 0;
            }
        });
        this._monitorSelection(this._trigger);

        this._filterId     = gsettings.connect(`changed::${Fields.FILTER}`, () => { this._filter = gsettings.get_string(Fields.FILTER); });
        this._appslistId   = gsettings.connect(`changed::${Fields.APPSLIST}`, () => { this._appslist = gsettings.get_string(Fields.APPSLIST); });
        this._lazymodeId   = gsettings.connect(`changed::${Fields.LAZYMODE}`, () => { this._lazymode = gsettings.get_boolean(Fields.LAZYMODE); });
        this._textstripId  = gsettings.connect(`changed::${Fields.TEXTSTRIP}`, () => { this._textstrip = gsettings.get_boolean(Fields.TEXTSTRIP); });
        this._blackwhiteId = gsettings.connect(`changed::${Fields.BLACKWHITE}`, () => { this._blackwhite = gsettings.get_boolean(Fields.BLACKWHITE); });
        this._triggerId    = gsettings.connect(`changed::${Fields.TRIGGER}`, () => {
            this._trigger = gsettings.get_uint(Fields.TRIGGER);
            if(this._selectionChangedID)
                global.display.get_selection().disconnect(this._selectionChangedID), this._selectionChangedID = 0;
            this._monitorSelection(this._trigger);
        });
        this._shortcutId = gsettings.connect(`changed::${Fields.SHORTCUT}`, () => {
            this._shortcut = gsettings.get_boolean(Fields.SHORTCUT);
            Main.wm.removeKeybinding(Fields.TOGGLE);
            if(this._shortcut) this._addKeyBindings();
        });
    }

    _fetchSettings() {
        this._trigger    = gsettings.get_uint(Fields.TRIGGER);
        this._filter     = gsettings.get_string(Fields.FILTER);
        this._appslist   = gsettings.get_string(Fields.APPSLIST);
        this._lazymode   = gsettings.get_boolean(Fields.LAZYMODE);
        this._shortcut   = gsettings.get_boolean(Fields.SHORTCUT);
        this._textstrip  = gsettings.get_boolean(Fields.TEXTSTRIP);
        this._blackwhite = gsettings.get_boolean(Fields.BLACKWHITE);
    }

    _monitorSelection(tgg) {
        switch(tgg) {
        case TRIGGER.ICON:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
                    if(!text) return;
                    this._pointer = global.get_pointer().slice(0,2);
                    let tmpSelection = this._textstrip ? text.trim() : text;
                    this._selection = tmpSelection;
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        if(this._selection !== tmpSelection) return;
                        if(!this._lazymode) {
                            this._iconBar._show(...this._pointer, this._wmclass, this._selection);
                        } else {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                                if(this._pointer[1] - global.get_pointer()[1] > 5)
                                    this._iconBar._show(...this._pointer, this._wmclass, this._selection);
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                });
            });
            break;
        case TRIGGER.AUTO:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) =>  {
                    if(!text) return;
                    this._pointer = global.get_pointer().slice(0, 2);
                    this._selection = this._textstrip ? text.trim() : text;
                    if(!this._filter || RegExp(this._filter, 'i').test(this._selection))
                        this._panel._lookUp(this._selection, this._pointer);
                });
            });
            break;
        case TRIGGER.KEYBOARD:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                let mod = global.get_pointer()[2];
                if(mod != MODIFIERS1 && mod != MODIFIERS2) return;
                St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) =>  {
                    if(!text) return;
                    this._pointer = global.get_pointer().slice(0, 2);
                    this._selection = this._textstrip ? text.trim() : text;
                    if(!this._filter || RegExp(this._filter, 'i').test(this._selection))
                        this._panel._lookUp(this._selection, this._pointer);
                });
            });
            break;
        default:
           break;
        }
    }

    _runWithBash(popup, clip, paste, cmd) {
        let title = global.display.get_focus_window().title.toString();
        let rcmd = cmd.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/LDTITLE/g, GLib.shell_quote(title));
        if(popup|clip|paste) {
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', 'set -o pipefail;' + rcmd],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if(proc.get_exit_status() === 0) {
                        if(paste) {
                            this._action.copy(stdout.trim());
                            this._action.stroke('Control_L+v');
                        } else {
                            if(clip) this._action.copy(stdout.trim());
                            if(popup) this._panel._show(stdout.trim(), this._selection, this._pointer);
                        }
                    } else {
                        this._panel._show(stderr.trim(), this._selection, this._pointer);
                    }
                } catch(e) {
                    Main.notifyError(Me.metadata.name, e.message);
                }
            });
        } else {
            this._spawnWithGio(rcmd);
        }
    }

    _runWithEval(popup, clip, paste, cmd) {
        try {
            let LDWORD = this._selection;
            let LDTITLE = global.display.get_focus_window().title;
            let key = x => this._action.stroke(x);
            let copy = x => this._action.copy(x);
            if(paste) {
                this._action.copy(eval(cmd).toString());
                this._action.stroke('Control_L+v');
            } else if(popup|clip) {
                if(clip) copy(eval(cmd).toString());
                if(popup) this._panel._show(eval(cmd).toString(), this._selection, this._pointer);
            } else {
                eval(cmd);
            }
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    _addKeyBindings() {
        let ModeType = Shell.hasOwnProperty('ActionMode') ? Shell.ActionMode : Shell.KeyBindingMode;
        Main.wm.addKeybinding(Fields.TOGGLE, gsettings, Meta.KeyBindingFlags.NONE, ModeType.ALL, () => {
            if(this._iconBar._tooltips)
                Main.notify(Me.metadata.name, _("Switch to %s mode").format(Object.keys(TRIGGER)[(this._trigger + 1) % 3]));
            gsettings.set_uint(Fields.TRIGGER, (this._trigger + 1) % 3);
        });
    }

    destory() {
        if(this._shortcut)
            Main.wm.removeKeybinding(Fields.TOGGLE);
        if(this._iconBarID)
            this._iconBar.disconnect(this._iconBarID), this._iconBarID = 0;
        if(this._onWindowChangedID)
            global.display.disconnect(this._onWindowChangedID), this._onWindowChangedID = 0;
        if(this._selectionChangedID)
            global.display.get_selection().disconnect(this._selectionChangedID), this._selectionChangedID = 0;
        for(let x in this)
            if(RegExp(/^_.+Id$/).test(x)) eval(`if(this.%s) gsettings.disconnect(this.%s), this.%s = 0;`.format(x, x, x));

        this._iconBar.destory();
        this._panel.destroy();
        this._iconBar = null;
        this._panel = null;
        this._action = null;
    }
});

const DictAction = GObject.registerClass(
class DictAction extends GObject.Object {
    _init() {
        super._init();
        let seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    _release(keyname) {
        this._keyboard.notify_keyval(
            Clutter.get_current_event_time(),
            Gdk.keyval_from_name(keyname),
            Clutter.KeyState.RELEASED
        );
    }

    _press(keyname) {
        this._keyboard.notify_keyval(
            Clutter.get_current_event_time(),
            Gdk.keyval_from_name(keyname),
            Clutter.KeyState.PRESSED
        );
    }

    stroke(keystring) { // TODO: Modifier keys aren't working on Wayland (input area)
        try {
            keystring.split(/\s+/).forEach((keys, i) => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, i * 100, () => {
                    let keyarray = keys.split('+');
                    keyarray.forEach(key => this._press(key));
                    keyarray.slice().reverse().forEach(key => this._release(key));
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    paste(string) { // TODO: not working
        Main.inputMethod.commit(string);
    }

    copy(string) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, string);
    }

    search() {
        this.stroke('Control_L+c Super_L Control_L+v');
    }
});

const Extension = GObject.registerClass(
class Extension extends GObject.Object {
    _init() {
        super._init();
        let logfilePath = Gio.file_new_for_path(GLib.get_home_dir() + '/.cache/gnome-shell-extension-light-dict/');
        if(!logfilePath.query_exists(null)) logfilePath.make_directory(Gio.Cancellable.new());
    }

    enable() {
        this._dict = new LightDict();
        if(gsettings.get_boolean(Fields.DEFAULT)) {
            this._dict._panel.add_style_class_name('default');
            this._dict._iconBar.add_style_class_name('default');
        }
        this._defaultId = gsettings.connect(`changed::${Fields.DEFAULT}`, () => {
            if(gsettings.get_boolean(Fields.DEFAULT)) {
                this._dict._panel.add_style_class_name('default');
                this._dict._iconBar.add_style_class_name('default');
            } else {
                this._dict._panel.remove_style_class_name('default');
                this._dict._iconBar.remove_style_class_name('default');
            }
        })
    }

    disable() {
        if(this._defaultId)
            gsettings.disconnect(this._defaultId), this._defaultId = 0;
        this._dict.destory();
        this._dict = null;
    }
});

function init() {
    return new Extension();
}

