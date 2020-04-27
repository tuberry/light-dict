// vim:fdm=syntax
// by: tuberry@gtihub
'use strict';

const Main = imports.ui.main;
const BoxPointer = imports.ui.boxpointer;
const { Meta, Shell, Clutter, Gio, GLib, GObject, St, Pango, Gdk, Atspi } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.prefs.Fields;

const TRIGGER   = { ICON: 0, KEYBOARD: 1, AUTO: 2 };
const LOGSLEVEL = { NEVER: 0, CLICK: 1, HOVER: 2, ALWAYS: 3 };
const MODIFIERS = { Alt_L: 0x40, Control_L: 0x25, Shift_L: 0x32, Super_L: 0x85 };

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
        this._pageIndex = 1;
        this._iconsBox = [];
        this._visibleBox = [];

        this._fetchSettings();
        this._connectSignals();
        if(this._tooltips) this._addTooltips();
        this._acommands.forEach(x => this._iconBarMaker(x));
    }

    _connectSignals() {
        this._settingChangedId = gsettings.connect('changed', this._onSettingChanged.bind(this));
        this._leaveIconBarId = this.connect('leave-event', () => {
            if(this._tooltips) this._iconTooltips.hide();
            this.visible = false;
        });
        this._enterIconBarId = this.connect('enter-event', () => {
            if(this._autohideDelayId)
                GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
            this.visible = true;
        });
    }

    _removeTooltips(tog) {
        Main.layoutManager.uiGroup.remove_actor(this._iconTooltips);
        this._iconTooltips.destroy();
        this._iconTooltips = null;
    }

    _addTooltips() {
        this._iconTooltips = new St.Label({
            visible: false,
            style_class: 'light-dict-tooltip light-dict-content',
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
        case Clutter.ScrollDirection.UP:
            this._pageIndex--;
            break;
        case Clutter.ScrollDirection.DOWN:
            this._pageIndex++;
            break;
        }
        this._updateIconBar();
        return Clutter.EVENT_PROPAGATE;
    }

    _fetchSettings() {
        this._xoffset   = gsettings.get_int(Fields.XOFFSET);
        this._yoffset   = gsettings.get_int(Fields.YOFFSET);
        this._autohide  = gsettings.get_uint(Fields.AUTOHIDE);
        this._pagesize  = gsettings.get_uint(Fields.PAGESIZE);
        this._acommands = gsettings.get_strv(Fields.ACOMMANDS);
        this._tooltips  = gsettings.get_boolean(Fields.TOOLTIPS);
    }

    _onSettingChanged() {
        let acommands = gsettings.get_strv(Fields.ACOMMANDS);
        if(this._acommands.toString() != acommands.toString()) {
            this._pageIndex = 1;
            this._iconBarEraser();
            this._acommands = acommands;
            this._acommands.forEach(x => this._iconBarMaker(x));
        }
        let pagesize = gsettings.get_uint(Fields.PAGESIZE);
        if(this._pagesize != pagesize) {
            this._pageIndex = 1;
            this._pagesize = pagesize;
        }
        let tooltip = gsettings.get_boolean(Fields.TOOLTIPS);
        if(this._tooltips != tooltip)
            tooltip ? this._addTooltips() : this._removeTooltips();
        this._fetchSettings()
    }

    _showIconBar(x, y, fw, text) {
        if(this._xoffset || this._yoffset) {
            this.set_position(Math.round(x + this._xoffset), Math.round(y + this._yoffset));
        } else {
            let [W, H] = this.get_size();
            this.set_position(Math.round(x - W / 2), Math.round(y - H * 1.5));
        }
        this._updateVisible(fw, text);
        this.visible = true;

        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;

        this._autohideDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide, () => {
            this.visible = false;
            this._autohideDelayId = 0;
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
                style_class: `light-dict-button light-dict-button-${x.icon}`,
            });
            btn.child = new St.Icon({
                icon_name: x.icon,
                fallback_icon_name: 'help',
                style_class: `light-dict-button-icon light-dict-button-icon-${x.icon}`,
            }); // St.Bin.child
            if(x.windows && x.windows.length) btn.windows = x.windows;
            if(x.regexp) btn.regexp = x.regexp;
            btn.onClickId = btn.connect('clicked', (actor, event) => {
                this.visible = false;
                this.emit('iconbar-signals', [x.popup, x.clip, x.type, x.paste].map(x => x ? '1' : '0').join(''), x.command);
                return Clutter.EVENT_PROPAGATE;
            });
            btn.onEnterId = btn.connect('enter-event', () => {
                if(!this._tooltips) return;
                btn.entered = true;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide / 2, () => {
                    if(btn.entered === undefined || !btn.entered || !this.visible) return GLib.SOURCE_REMOVE;
                    this._iconTooltips.set_position(global.get_pointer()[0], this.get_position()[1] + this.get_size()[1] + 5);
                    this._iconTooltips.set_text(x.tooltip ? x.tooltip : x.icon);
                    this._iconTooltips.show();
                    return GLib.SOURCE_REMOVE;
                });
            });
            btn.onLeaveId = btn.connect('leave-event', () => {
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
            if(x.onClickId) x.disconnect(x.onClickId), x.onClickId = undefined;
            if(x.onEnterId) x.disconnect(x.onClickId), x.onEnterId = undefined;
            if(x.onLeaveId) x.disconnect(x.onClickId), x.onLeaveId = undefined;
            x.entered = undefined;
            this.remove_child(x);
            x = null;
        });
        this._iconsBox.length = 0;
        this._visibleBox.length = 0;
    }

    destory() {
        if(this._leaveIconBarId)
            this.disconnect(this._leaveIconBarId), this._leaveIconBarId = 0;
        if(this._enterIconBarId)
            this.disconnect(this._enterIconBarId), this._enterIconBarId = 0;
        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
        if(this._settingChangedId)
            gsettings.disconnect(this._settingChangedId), this._settingChangedId = 0;
        if(this._tooltips) this._removeTooltips();
        this._iconBarEraser();
        super.destroy();
    }
});

const DictPopup = GObject.registerClass(
class DictPopup extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.TOP, {
            style_class: 'light-dict-boxpointer',
        });
        Main.layoutManager.addChrome(this);

        this._pointer = [];
        this._selection = '';
        this._notFound = false;
        this._panelClicked = false;

        this._loadSettings();
        this._buildPopupPanel();
        this._bulidPopupBar();
        this._listenSelection(this._trigger);
    }

    _loadSettings() {
        this._fetchSettings();
        this._edit = new DictEditable();
        if(this._shortcut) this._addKeyBindings();
        this._settingChangedId = gsettings.connect('changed', this._onSettingChanged.bind(this));
        this._copyToClip = x => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, x);
    }

    _fetchSettings() {
        this._trigger    = gsettings.get_uint(Fields.TRIGGER);
        this._autohide   = gsettings.get_uint(Fields.AUTOHIDE);
        this._filter     = gsettings.get_string(Fields.FILTER);
        this._logslevel  = gsettings.get_uint(Fields.LOGSLEVEL);
        this._openurl    = gsettings.get_string(Fields.OPENURL);
        this._appslist   = gsettings.get_string(Fields.APPSLIST);
        this._ccommand   = gsettings.get_string(Fields.CCOMMAND);
        this._dcommand   = gsettings.get_string(Fields.DCOMMAND);
        this._shortcut   = gsettings.get_boolean(Fields.SHORTCUT);
        this._hidetitle  = gsettings.get_boolean(Fields.HIDETITLE);
        this._sensitive  = gsettings.get_boolean(Fields.SENSITIVE);
        this._textstrip  = gsettings.get_boolean(Fields.TEXTSTRIP);
        this._blackwhite = gsettings.get_boolean(Fields.BLACKWHITE);
    }

    _onSettingChanged() {
        if(gsettings.get_boolean(Fields.SENSITIVE) != this._sensitive) {
            this._removeDummyCursor(this._sensitive);
            this._addDummyCursor(!this._sensitive);
        }

        let trigger = gsettings.get_uint(Fields.TRIGGER);
        if(trigger != this._trigger) {
            if(this._selectionChangedId)
                global.display.get_selection().disconnect(this._selectionChangedId), this._selectionChangedId = 0;
            if(trigger === 0 || trigger === 2)
                this._listenSelection(trigger);
        }

        if(gsettings.get_boolean(Fields.SHORTCUT) != this._shortcut) {
            Main.wm.removeKeybinding(Fields.SHORTCUTNAME);
            if(!this._shortcut)
                this._addKeyBindings();
        }

        this._panelBox._word.visible = !gsettings.get_boolean(Fields.HIDETITLE);
        this._fetchSettings();
    }

    _buildPopupPanel() {
        this._dummyCursor = new St.Widget({ opacity: 0, reactive: true });
        this._dummyCursor.set_size(Math.round(40), Math.round(40));
        this.setPosition(this._dummyCursor, 0);
        this._addDummyCursor(this._sensitive);
        this._panelBox = new St.BoxLayout({
            reactive: true,
            vertical: true,
            visible: false,
            style_class: 'light-dict-content',
        });

        this._leavePanelId = this._panelBox.connect('leave-event', this._hidePanel.bind(this));
        this._enterPanelId = this._panelBox.connect('enter-event', (actor, event) => {
            this._panelClicked = false;
            this._panelBox.visible = true;
            if(this._logslevel === LOGSLEVEL.HOVER) this._recordLog();
            if(this._autohideDelayId) GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
        });
        this._clickPanelId = this._panelBox.connect('button-press-event', (actor, event) => {
            if(event.get_button() === 1 && this._ccommand)
                this._ccommand.split('#').forEach(x => this._spawnWithGio(x.split('LDWORD').join(GLib.shell_quote(this._selection))));
            switch(event.get_button()*!this._panelClicked) {
            case 1:
                if(this._logslevel === LOGSLEVEL.CLICK) this._recordLog();
                break;
            case 2:
                this._copyToClip(this._panelBox._info.get_text());
                break;
            case 3:
                this._spawnWithGio('gio open ' + this._openurl.split('LDWORD').join(GLib.shell_quote(this._selection)));
                if(this._notFound) this._hidePanel();
                break;
            }
            this._panelClicked = true;
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

        this.bin.set_child(this._panelBox);
    }

    _bulidPopupBar() {
        this._iconBar = new DictIconBar();
        this._iconBarId = this._iconBar.connect('iconbar-signals', (area, tag, cmd) => {
            let [popup, clip, type, paste] = Array.from(tag, i => i === '1');
            type ? this._runWithEval(popup, clip, paste, cmd) : this._runWithBash(popup, clip, paste, cmd);
        });
        Main.layoutManager.addChrome(this._iconBar);

        this._onWindowChangedId = global.display.connect('notify::focus-window', () => {
            this._hidePanel();
            this._iconBar.hide();
            let FW = global.display.get_focus_window();
            this._wmclass = FW ? FW.wm_class : null;
            let wlist = this._appslist === '*' | this._appslist.split('#').includes(this._wmclass);
            if(this._blackwhite ? wlist : !wlist) {
                if(!this._selectionChangedId) this._listenSelection(this._trigger);
            } else {
                if(this._selectionChangedId)
                    global.display.get_selection().disconnect(this._selectionChangedId), this._selectionChangedId = 0;
            }
        });
    }

    _listenSelection(tgg) {
        switch(tgg) {
        case TRIGGER.ICON:
            this._selectionChangedId = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
                    if(!text) return; // TODO: delay
                    this._pointer = global.get_pointer().slice(0,2);
                    let tmpSelection = this._textstrip ? text.trim() : text;
                    this._selection = tmpSelection;
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                        // let euclidean = (p, q) => Math.sqrt((p[0]-q[0])**2 + (p[1]-q[1])**2) > 5;
                        // if(this._selection !== tmpSelection || euclidean(this._pointer, global.get_pointer().slice(2)) return;
                        if(this._selection !== tmpSelection) return;
                        this._iconBar._showIconBar(...this._pointer, this._wmclass, this._selection);
                        return GLib.SOURCE_REMOVE;
                    }); // some apps aren't lazy to signal `owner-changed` event, this `timeout` detects hightlight is finished or not
                });
            });
            break;
        case TRIGGER.AUTO:
            this._selectionChangedId = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY) return;
                St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) =>  {
                    if(!text) return;
                    this._pointer = global.get_pointer().slice(0,2);
                    this._selection = this._textstrip ? text.trim() : text;
                    if(!this._filter || RegExp(this._filter, 'i').test(this._selection))
                        this._lookUp(this._selection);
                });
            });
            break;
        default:
           break;
        }
    }

    _addDummyCursor(sen) {
        if(sen) {
            Main.layoutManager.uiGroup.add_actor(this._dummyCursor);
        } else {
            this._scrollId = this._dummyCursor.connect('scroll-event', this._hidePanel.bind(this));
            this._clickId = this._dummyCursor.connect('button-press-event', (actor, event) => {
                this._hidePanel();
                if(event.get_button() === 3) this._copyToClip(this._selection);
            });
            Main.layoutManager.addChrome(this._dummyCursor);
        }
    }

    _removeDummyCursor(sen) {
        if(sen) {
            Main.layoutManager.uiGroup.remove_actor(this._dummyCursor);
        } else {
            if(this._scrollId)
                this._dummyCursor.disconnect(this._scrollId), this._scrollId = 0;
            if(this._clickId)
                this._dummyCursor.disconnect(this._clickId), this._scrollId = 0;
            Main.layoutManager.removeChrome(this._dummyCursor);
        }
    }

    _addKeyBindings() {
        let ModeType = Shell.hasOwnProperty('ActionMode') ? Shell.ActionMode : Shell.KeyBindingMode;
        Main.wm.addKeybinding(Fields.SHORTCUTNAME, gsettings, Meta.KeyBindingFlags.NONE, ModeType.ALL, () => {
            St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
                if(!text) return;
                this._pointer = global.get_pointer().slice(0,2);
                this._selection = this._textstrip ? text.trim() : text;
                this._lookUp(this._selection);
            });
        });
    }

    _runWithBash(popup, clip, paste, cmd) {
        let title = global.display.get_focus_window().title.toString();
        let rcmd = cmd.split('LDWORD').join(GLib.shell_quote(this._selection)).split('LDTITLE').join(GLib.shell_quote(title));
        if(popup|clip|paste) {
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', 'set -o pipefail;' + rcmd],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    let ok = proc.get_exit_status() === 0;
                    if(ok) {
                        if(paste) {
                            this._copyToClip(stdout.slice(0, -1));
                            this._edit.paste();
                        } else {
                            if(clip) this._copyToClip(stdout.slice(0, -1));
                            if(popup) this._showPanel(stdout.slice(0, -1), this._selection);
                        }
                    } else {
                        this._showPanel(stderr.slice(0, -1), this._selection);
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
            let key = x => this._edit._stroke(x);
            let copy = x => this._copyToClip(x);
            if(paste) {
                copy(eval(cmd).toString());
                this._edit.paste();
            } else if(popup|clip) {
                if(clip) copy(eval(cmd).toString());
                if(popup) this._showPanel(eval(cmd).toString(), this._selection);
            } else {
                eval(cmd);
            }
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    _spawnWithGio(rcmd) {
        try {
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', rcmd],
                flags: (Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
            });
            proc.init(null);
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    _lookUp(text) {
        let rcmd = this._dcommand.split('LDWORD').join(GLib.shell_quote(text));
        let proc = new Gio.Subprocess({
            argv: ['/bin/bash', '-c', 'set -o pipefail;' + rcmd],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                this._notFound = proc.get_exit_status() !== 0;
                this._showPanel(this._notFound ? stderr.slice(0, -1) : stdout.slice(0, -1), text);
                if(this._logslevel === LOGSLEVEL.ALWAYS) this._recordLog();
            } catch(e) {
                Main.notifyError(Me.metadata.name, e.message);
            }
        });
        // var Y = gen => (f => f(f)) (f => gen (x => f(f)(x)));
    }

    _hidePanel() {
        if(!this._panelBox.visible)
            return;
        // If the panel appears under the pointer after clicking the icon bar,
        // it will receive 'enter-event' and 'leave-event' then vanish immediately?
        let [mx, my] = global.get_pointer();
        let [wt, ht] = this.get_size();
        let [px, py] = this.get_position();
        if(mx > px + 1 && my > py + 1 && mx < px + wt - 1 && my < py + ht -1) return;

        this._panelBox.visible = false
        this.close(BoxPointer.PopupAnimation.FULL);
        this._dummyCursor.set_position(...global.display.get_size());
    }

    _showPanel(info, word) {
        this._panelBox._info.set_text(info);
        if(this._panelBox._word.visible)
            this._panelBox._word.set_text(word);

        this._dummyCursor.set_position(...this._pointer.map(x => x - 20));
        if(!this._panelBox.visible) {
            this._panelBox.visible = true;
            this.open(BoxPointer.PopupAnimation.FULL);
            this.get_parent().set_child_above_sibling(this, null);
        }

        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId);

        this._autohideDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide, () => {
            this._hidePanel();
            this._autohideDelayId = 0;
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
        let logfile = Gio.file_new_for_path(GLib.get_home_dir()+ '/.cache/gnome-shell-extension-light-dict/light-dict.log');
        let log = [dateFormat("YYYY-mm-dd HH:MM:SS", new Date()), this._selection, this._notFound ? 0 : 1].join('\t') + '\n';
        try {
            logfile.append_to(Gio.FileCreateFlags.NONE, null).write(log, null);
        } catch(e) {
            Main.notifyError(Me.metadata.name, e.message);
        }
    }

    destory() {
        if(this._shortcut)
            Main.wm.removeKeybinding(Fields.SHORTCUTNAME);
        if(this._iconBarId)
            this._iconBar.disconnect(this._iconBarId), this._iconBarId = 0;
        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
        if(this._enterPanelId)
            this._panelBox.disconnect(this._enterPanelId), this._enterPanelId = 0;
        if(this._leavePanelId)
            this._panelBox.disconnect(this._leavePanelId), this._leavePanelId = 0;
        if(this._clickPanelId)
            this._panelBox.disconnect(this._clickPanelId), this._clickPanelId = 0;
        if(this._settingChangedId)
            gsettings.disconnect(this._settingChangedId), this._settingChangedId = 0;
        if(this._onWindowChangedId)
            global.display.disconnect(this._onWindowChangedId), this._onWindowChangedId = 0;
        if(this._selectionChangedId)
            global.display.get_selection().disconnect(this._selectionChangedId), this._selectionChangedId = 0;

        Main.layoutManager.removeChrome(this._iconBar);
        Main.layoutManager.removeChrome(this);
        this._removeDummyCursor();
        this._iconBar.destory();
        super.destroy();
    }
});

const DictEditable = GObject.registerClass(
class DictEditable extends GObject.Object {
    _init() {
        super._init();
        if(Atspi.init() === 2)
            throw new Error('Failed to start AT-SPI');
    }

    _release(keyname) {
        if(!Object.keys(MODIFIERS).includes(keyname))
            return;
        Atspi.generate_keyboard_event(
            MODIFIERS[keyname],
            null,
            Atspi.KeySynthType.RELEASE
        );
    }

    _press(keyname) {
        if(Object.keys(MODIFIERS).includes(keyname)) {
            Atspi.generate_keyboard_event(
                MODIFIERS[keyname],
                null,
                Atspi.KeySynthType.PRESS
            );
        } else {
            Atspi.generate_keyboard_event(
                Gdk.keyval_from_name(keyname),
                null,
                Atspi.KeySynthType.PRESSRELEASE | Atspi.KeySynthType.SYM
            );
        }
    }

    _stroke(keystring) {
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

    paste() {
        this._stroke('Control_L+v');
    }

    search() {
        this._stroke('Control_L+c Super_L Control_L+v');
    }
});

const LightDict = GObject.registerClass(
class LightDict extends GObject.Object {
    _init() {
        super._init();
        let logfilePath = Gio.file_new_for_path(GLib.get_home_dir()+ '/.cache/gnome-shell-extension-light-dict/');
        if(!logfilePath.query_exists(null)) logfilePath.make_directory(Gio.Cancellable.new());
    }

    enable() {
        this._dictPopup = new DictPopup();
    }

    disable() {
        this._dictPopup.destory();
    }
});

function init() {
    return new LightDict();
}

