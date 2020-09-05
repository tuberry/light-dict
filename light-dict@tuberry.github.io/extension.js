// vim:fdm=syntax
// by: tuberry@gtihub
'use strict';

const Main = imports.ui.main;
const BoxPointer = imports.ui.boxpointer;
const Keyboard = imports.ui.status.keyboard;
const { Meta, Shell, Clutter, IBus, Gio, GLib, GObject, St, Pango, Gdk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.prefs.Fields;
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

const TRIGGER   = { ICON: 0, KEYBOARD: 1, AUTO: 2 };
const LOGSLEVEL = { NEVER: 0, CLICK: 1, HOVER: 2, ALWAYS: 3 };
const MODIFIERS = Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SHIFT_MASK;
const DBUSINTERFACE = `
<node>
    <interface name="org.gnome.Shell.Extensions.lightdict">
        <method name="lookUp">
            <arg name="name" type="s" direction="in"/>
        </method>
        <method name="iconBar">
            <arg name="name" type="s" direction="in"/>
        </method>
    </interface>
</node>
`

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
        this._bcommands.forEach(x => this._iconBarMaker(x));
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
        this._bcommandsId = gsettings.connect(`changed::${Fields.BCOMMANDS}`, () => {
            this._pageIndex = 1;
            this._iconBarEraser();
            this._bcommands = gsettings.get_strv(Fields.BCOMMANDS);
            this._bcommands.forEach(x => this._iconBarMaker(x));
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
        this._bcommands = gsettings.get_strv(Fields.BCOMMANDS);
        this._tooltips  = gsettings.get_boolean(Fields.TOOLTIPS);
    }

    _removeTooltips() {
        Main.layoutManager.removeChrome(this._iconTooltips);
        this._iconTooltips.destroy();
        this._iconTooltips = null;
    }

    _addTooltips() {
        this._iconTooltips = new St.Label({
            visible: false,
            style_class: 'light-dict-tooltips',
        });
        Main.layoutManager.addTopChrome(this._iconTooltips);
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

    _show(pointer, fw, text) {
        if(this._xoffset || this._yoffset) {
            this.set_position(Math.round(pointer[0] + this._xoffset), Math.round(pointer[1] + this._yoffset));
        } else {
            let [W, H] = this.get_size();
            this.set_position(Math.round(pointer[0] - W / 2), Math.round(pointer[1] - H * 1.5));
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
            switch((x.hasOwnProperty("windows") << 1) + x.hasOwnProperty("regexp")) {
            case 0: x._visible = true; break;
            case 1: x._visible = RegExp(x.regexp).test(text); break;
            case 2: x._visible = x.windows.toLowerCase().includes(fw.toLowerCase()); break;// wmclass is a litte different on Xog and Wayland
            case 3: x._visible = x.windows.toLowerCase().includes(fw.toLowerCase()) & RegExp(x.regexp).test(text); break;
            }
        });
        this._visibleBox = this._iconsBox.filter(x => x._visible);
        this._updateIconBar();
    }

    _iconBarMaker(cmd) {
        let x = JSON.parse(cmd);
        if(!x.enable) return;
        let btn = new St.Button({
            reactive: true,
            track_hover: true,
            style_class: `light-dict-button-${x.icon || 'help'} light-dict-button`,
        });
        btn.child = new St.Icon({
            icon_name: x.icon || 'help',
            fallback_icon_name: 'help',
            style_class: `light-dict-button-icon-${x.icon || 'help'} light-dict-button-icon`,
        }); // St.Bin.child
        if(x.windows) btn.windows = x.windows;
        if(x.regexp) btn.regexp = x.regexp;
        btn.onClickID = btn.connect('clicked', (actor, event) => {
            this.visible = false;
            this.emit('iconbar-signals', [x.popup, x.clip, x.type, x.commit].map(x => x ? '1' : '0').join(''), x.command);
            return Clutter.EVENT_PROPAGATE;
        });
        btn.onEnterID = btn.connect('enter-event', () => {
            if(!this._tooltips) return;
            btn.entered = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide / 2, () => {
                if(!btn.entered || !this.visible) return GLib.SOURCE_REMOVE;
                this._iconTooltips.set_position(global.get_pointer()[0], this.get_position()[1] + this.get_size()[1] + 5);
                this._iconTooltips.set_text(x.tooltip ? x.tooltip : x.icon || 'help');
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
        super._init(St.Side.TOP, {});
        this.style_class = 'light-dict-boxpointer';
        Main.layoutManager.addChrome(this);

        this._selection = '';
        this._notFound = false;
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
            case 2: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._panelBox._info.get_text()); break;
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
    }

    get _scrollable() {
        let [, height] = this._scrollView.get_preferred_height(-1);
        let maxHeight = this._scrollView.get_theme_node().get_max_height();
        if(maxHeight < 0) maxHeight = global.display.get_size()[1] * 7 / 16;

        return height >= maxHeight;
    }

    _buildPopupPanel() {
        this._scrollView = new St.ScrollView({
            visible: false,
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            style_class: 'light-dict-scroll',
            style: 'max-height: %dpx'.format(global.display.get_size()[1] * 7 / 16),
        });

        this._panelBox = new St.BoxLayout({
            reactive: true,
            vertical: true,
            track_hover: true,
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

        this._scrollView.add_actor(this._panelBox);
        this.bin.add_actor(this._scrollView);
    }

    _addDummyCursor(sen) {
        this._dummyCursor = new St.Widget({ opacity: 0, reactive: true });
        this._dummyCursor.set_size(Math.round(40), Math.round(40));
        this.setPosition(this._dummyCursor, 0);
        if(sen) {
            Main.layoutManager.addTopChrome(this._dummyCursor);
        } else {
            this._scrollID = this._dummyCursor.connect('scroll-event', this._hide.bind(this));
            this._clickID = this._dummyCursor.connect('button-press-event', this._hide.bind(this));
            Main.layoutManager.addChrome(this._dummyCursor);
        }
    }

    _removeDummyCursor(sen) {
        if(sen) {
            Main.layoutManager.removeChrome(this._dummyCursor);
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
                this._show(pointer, this._notFound ? stderr.trim() : stdout.trim(), text);
                if(this._logslevel === LOGSLEVEL.ALWAYS) this._recordLog();
            } catch(e) {
                Main.notifyError(Me.metadata.name, e.message);
            }
        });
    }

    _hide() {
        if(!this._scrollView.visible) return;
        //NOTE: do not hide on scrolling
        let [mx, my] = global.get_pointer();
        let [wt, ht] = this.get_size();
        let [px, py] = this.get_position();
        if(mx > px + 1 && my > py + 1 && mx < px + wt - 1 && my < py + ht -1) return;

        this._scrollView.visible = false;
        this.close(BoxPointer.PopupAnimation.FADE);
        this._panelBox._info.set_text(Me.metadata.name);
        this._dummyCursor.set_position(...global.display.get_size());
    }

    _show(pointer, info, word) {
        this._selection = word;
        this._dummyCursor.set_position(pointer[0] - 20, pointer[1] - 20);

        try {
            Pango.parse_markup(info, -1, '');
            this._panelBox._info.clutter_text.set_markup(info);
        } catch(e) {
            this._panelBox._info.set_text(info);
        }

        if(this._scrollable) {
            this._scrollView.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this._scrollView.vscroll.get_adjustment().set_value(0);
        } else {
            this._scrollView.vscrollbar_policy = St.PolicyType.NEVER;
        }

        if(this._hidetitle)
            this._panelBox._word.set_text(word);
        if(!this._scrollView.visible) {
            this._scrollView.visible = true;
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
        this._removeDummyCursor();
        this._scrollView = null;
        super.destroy();
    }
});

const LightDict = GObject.registerClass(
class LightDict extends GObject.Object {
    _init() {
        super._init();

        this._pointer = [];
        this._wmclass = '';
        this._selection = '';
        this._panel = new DictPanel();
        this._action = new DictAction();
        this._iconBar = new DictIconBar();

        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUSINTERFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/lightdict');

        this._loadSettings();
    }

    _loadSettings() {
        this._fetchSettings();
        if(this._shortcut) this._addKeyBindings();
        this._spawnWithGio = x => this._panel._spawnWithGio(x);
        this._iconBarID = this._iconBar.connect('iconbar-signals', (area, tag, cmd) => {
            let [popup, clip, type, commit] = Array.from(tag, i => i === '1');
            type ? this._runWithEval(popup, clip, commit, cmd) : this._runWithBash(popup, clip, commit, cmd);
        });
        this._onWindowChangedID = global.display.connect('notify::focus-window', () => {
            this._panel._hide();
            this._iconBar.hide();
            let FW = global.display.get_focus_window();
            this._wmclass = FW ? (FW.wm_class ? FW.wm_class : '') : '';
            let wlist = this._appslist === '*' || this._appslist.toLowerCase().includes(this._wmclass.toLowerCase());
            if(this._blackwhite ? wlist : !wlist) {
                if(!this._selectionChangedID) this._listenSelection(this._trigger);
            } else {
                if(this._selectionChangedID)
                    global.display.get_selection().disconnect(this._selectionChangedID), this._selectionChangedID = 0;
            }
        });
        this._listenSelection(this._trigger);

        this._filterId     = gsettings.connect(`changed::${Fields.FILTER}`, () => { this._filter = gsettings.get_string(Fields.FILTER); });
        this._appslistId   = gsettings.connect(`changed::${Fields.APPSLIST}`, () => { this._appslist = gsettings.get_string(Fields.APPSLIST); });
        this._lazymodeId   = gsettings.connect(`changed::${Fields.LAZYMODE}`, () => { this._lazymode = gsettings.get_boolean(Fields.LAZYMODE); });
        this._textstripId  = gsettings.connect(`changed::${Fields.TEXTSTRIP}`, () => { this._textstrip = gsettings.get_boolean(Fields.TEXTSTRIP); });
        this._blackwhiteId = gsettings.connect(`changed::${Fields.BLACKWHITE}`, () => { this._blackwhite = gsettings.get_boolean(Fields.BLACKWHITE); });
        this._triggerId    = gsettings.connect(`changed::${Fields.TRIGGER}`, () => {
            this._trigger = gsettings.get_uint(Fields.TRIGGER);
            if(this._selectionChangedID)
                global.display.get_selection().disconnect(this._selectionChangedID), this._selectionChangedID = 0;
            this._listenSelection(this._trigger);
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

    _listenSelection(tgg) {
        switch(tgg) {
        case TRIGGER.ICON:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                if(this._mouseUpID) GLib.source_remove(this._mouseUpID), this._mouseUpID = 0;
                let [, , initModifier] = global.get_pointer();
                if((this._lazymode && (initModifier & MODIFIERS) == 0)) return;
                let showIconbar = () => { this._iconBar._show(this._pointer, this._wmclass, this._selection); };
                if(initModifier & Clutter.ModifierType.BUTTON1_MASK) {
                    this._mouseUpID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        let [, , tmpModifier] = global.get_pointer();
                        if((initModifier ^ tmpModifier) == Clutter.ModifierType.BUTTON1_MASK) {
                            this._fetchSelection(showIconbar);
                            this._mouseUpID = 0;
                            return GLib.SOURCE_REMOVE;
                        } else {
                            return GLib.SOURCE_CONTINUE;
                        }
                    });
                } else {
                    this._fetchSelection(() => {// NOTE: Ctrl + C in Chromium will trigger primary selection
                        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (clip, text) =>  {
                            if(!text || this._selection != (this._textstrip ? text.trim().replace(/\n/g, ' ') : text))
                                showIconbar();
                        });
                    });
                }
            });
            break;
        case TRIGGER.AUTO:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                if(this._mouseUpID) GLib.source_remove(this._mouseUpID), this._mouseUpID = 0;
                let [, , initModifier] = global.get_pointer();
                let showPanelRgx = () => {
                    if(!this._filter || RegExp(this._filter).test(this._selection)) this._panel._lookUp(this._selection, this._pointer);
                };
                if(initModifier & Clutter.ModifierType.BUTTON1_MASK) {
                    this._mouseUpID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        let [, , tmpModifier] = global.get_pointer();
                        if((initModifier ^ tmpModifier) == Clutter.ModifierType.BUTTON1_MASK) {
                            this._fetchSelection(showPanelRgx);
                            this._mouseUpID = 0;
                            return GLib.SOURCE_REMOVE;
                        } else {
                            return GLib.SOURCE_CONTINUE;
                        }
                    });
                } else {
                    this._fetchSelection(() => {
                        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (clip, text) =>  {
                            if(!text || this._selection != (this._textstrip ? text.trim().replace(/\n/g, ' ') : text))
                                showPanelRgx();
                        });
                    });
                }
            });
            break;
        case TRIGGER.KEYBOARD:
            this._selectionChangedID = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                if(this._mouseUpID) GLib.source_remove(this._mouseUpID), this._mouseUpID = 0;
                let [, , initModifier] = global.get_pointer();
                if((initModifier & MODIFIERS) == 0) return;
                let showPanel = () => { this._panel._lookUp(this._selection, this._pointer); };
                if(initModifier & Clutter.ModifierType.BUTTON1_MASK) {
                    this._mouseUpID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                        let [, , tmpModifier] = global.get_pointer();
                        if((initModifier ^ tmpModifier) == Clutter.ModifierType.BUTTON1_MASK) {
                            this._fetchSelection(showPanel);
                            this._mouseUpID = 0;
                            return GLib.SOURCE_REMOVE;
                        } else {
                            return GLib.SOURCE_CONTINUE;
                        }
                    });
                } else {
                    this._fetchSelection(() => {
                        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (clip, text) =>  {
                            if(!text || this._selection != (this._textstrip ? text.trim().replace(/\n/g, ' ') : text))
                                showPanel();
                        });
                    });
                }
            });
            break;
        default:
           break;
        }
    }

    _fetchSelection(func) {
        St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clip, text) =>  {
            if(!text) return;
            this._pointer = global.get_pointer();
            this._selection = this._textstrip ? text.trim().replace(/\n/g, ' ') : text;
            func();
        });
    }

    _runWithBash(popup, clip, commit, cmd) {
        let title = global.display.get_focus_window().title.toString();
        let rcmd = cmd.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/LDTITLE/g, GLib.shell_quote(title));
        if(popup|clip|commit) {
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', 'set -o pipefail;' + rcmd],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if(proc.get_exit_status() === 0) {
                        let result = stdout.trim();
                        if(commit) this._action.commit(result);
                        if(clip) this._action.copy(result);
                        if(popup) this._panel._show(this._pointer, result, this._selection);
                    } else {
                        this._panel._show(this._pointer, stderr.trim(), this._selection);
                    }
                } catch(e) {
                    Main.notifyError(Me.metadata.name, e.message);
                }
            });
        } else {
            this._spawnWithGio(rcmd);
        }
    }

    _runWithEval(popup, clip, commit, cmd) {
        try {
            let LDWORD = this._selection;
            let LDTITLE = global.display.get_focus_window().title;
            let key = x => this._action.stroke(x);
            let copy = x => this._action.copy(x);
            if(popup|clip|commit) {
                let result = eval(cmd).toString();
                if(clip) this._action.copy(result);
                if(commit) this._action.commit(result);
                if(popup) this._panel._show(this._pointer, result, this._selection);
            } else {
                eval(cmd);
            }
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    _addKeyBindings() {
        Main.wm.addKeybinding(Fields.TOGGLE, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => {
            let next = (this._trigger + 1) % 3;
            Main.notify(Me.metadata.name, _("Switch to %s mode").format(Object.keys(TRIGGER)[next]));
            gsettings.set_uint(Fields.TRIGGER, next);
        });
    }

    lookUp(word) {
        if(word) {
            this._selection = word;
            this._pointer = global.get_pointer();
            this._panel._lookUp(this._selection, this._pointer);
        } else {
            this._fetchSelection(() => { this._panel._lookUp(this._selection, this._pointer); });
        }
    }

    iconBar(word) {
        if(word) {
            this._selection = word;
            this._pointer = global.get_pointer();
            this._iconBar._show(this._pointer, this._wmclass, this._selection);
        } else {
            this._fetchSelection(() => { this._iconBar._show(this._pointer, this._wmclass, this._selection); });
        }
    }

    destory() {
        if(this._mouseUpID)
            GLib.source_remove(this._mouseUpID), this._mouseUpID = 0;
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

        this._dbus.flush();
        this._dbus.unexport();
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
        this._input = Keyboard.getInputSourceManager();
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

    commit(string) {
        if(this._input.currentSource.type == Keyboard.INPUT_SOURCE_TYPE_IBUS) {
            if(this._input._ibusManager._panelService)
                this._input._ibusManager._panelService.commit_text(IBus.Text.new_from_string(string));
        } else {
            Main.inputMethod.commit(string); // TODO: not tested
        }
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
        });
    }

    disable() {
        if(this._defaultId)
            gsettings.disconnect(this._defaultId), this._defaultId = 0;
        this._dict.destory();
        this._dict = null;
    }
});

function init() {
    ExtensionUtils.initTranslations();
    return new Extension();
}

