// vim:fdm=syntax
// by: tuberry@gtihub.io

const { Meta, Shell, Clutter, Gio, GLib, GObject, St, Pango, Gdk, Atspi } = imports.gi;
const BoxPointer = imports.ui.boxpointer;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const Prefs = Me.imports.prefs;

const APPNAME = 'Light Dict';

const LOGSLEVEL = { NEVER: 0, HOVER: 1, CLICK: 2, ALWAYS: 3 };
const TRIGGER = { ICON: 0, KEYBOARD: 1, AUTO: 2 };

'use strict';

const DictIconBar = GObject.registerClass({
    Signals: {
        'iconbar-signals': { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
    },
}, class DictIconBar extends St.BoxLayout {
    _init() {
        super._init({
            vertical: false,
            reactive: true,
            visible: false,
            track_hover: true,
        });
        this.style_class = 'dict-popup-iconbox';
        this._pageIndex = 1;
        this._iconsBox = [];

        this._fetchSettings();
        this._updateIconBar();
        this._connectSignals();
    }

    _connectSignals() {
        this._settingChangedId = gsettings.connect('changed', this._onSettingChanged.bind(this));
        this._leaveIconBarId = this.connect('leave-event', () => this.visible = false);
        this._enterIconBarId = this.connect('enter-event', () => {
            if(this._autohideDelayId)
                GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
            this.visible = true;
        });
    }

    _updateIconBar() {
        this._iconBarEraser();
        if(this._pagesize === 0) {
            this._acommands.forEach(x => this._iconBarMaker(x));
        } else {
            this._acommands.forEach((x, i) => {
                if(i >= (this._pageIndex - 1)*this._pagesize && i < this._pageIndex*this._pagesize)
                    this._iconBarMaker(x);
            });
        }
    }

    vfunc_scroll_event(scrollEvent) {
        if(this._pagesize === 0) return;
        let pages = Math.ceil(this._acommands.length/(this._pagesize));
        if(pages === 1) return;
        switch (scrollEvent.direction) {
        case Clutter.ScrollDirection.UP:
            this._pageIndex = this._pageIndex - 1 === 0 ? pages : this._pageIndex - 1;
            this._updateIconBar();
            break;
        case Clutter.ScrollDirection.DOWN:
            this._pageIndex = this._pageIndex + 1 > pages ? 1 : this._pageIndex + 1;
            this._updateIconBar();
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _fetchSettings() {
        this._acommands = gsettings.get_strv(Prefs.Fields.ACOMMANDS);
        this._autohide  = gsettings.get_uint(Prefs.Fields.AUTOHIDE);
        this._xoffset   = gsettings.get_int(Prefs.Fields.XOFFSET);
        this._yoffset   = gsettings.get_int(Prefs.Fields.YOFFSET);
        this._pagesize  = gsettings.get_uint(Prefs.Fields.ICONPAGESIZE);
    }

    _onSettingChanged() {
        let acommands = gsettings.get_strv(Prefs.Fields.ACOMMANDS);
        if(this._acommands.toString() != acommands.toString()) {
            this._pageIndex = 1;
            this._acommands = acommands;
            this._updateIconBar();
        }
        let pages = gsettings.get_uint(Prefs.Fields.ICONPAGESIZE);
        if(this._pagesize != pages) {
            this._pageIndex = 1;
            this._pagesize = pages;
            this._updateIconBar();
        }
        this._fetchSettings()
    }

    _showIconBar(x, y) {
        if(this._xoffset||this._yoffset) {
            this.set_position(Math.round(x+this._xoffset), Math.round(y+this._yoffset));
        } else {
            let [W, H] = this.get_transformed_size();
            this.set_position(Math.round(x-W/2), Math.round(y-H*1.5));
        }

        this.visible = true;

        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;

        this._autohideDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._autohide, () => {
            this.visible = false;
            this._autohideDelayId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _iconBarMaker(cmds) {
        cmds.split('##').forEach(x => {
            let cmd = x.split('#');
            if(cmd.length != 3 || !RegExp('[01]{3}', 'i').test(cmd[1])) {
                Main.notifyError(APPNAME, 'Syntax error: ' + cmd);
                return false;
            }
            let btn = new St.Button({
                style_class: 'dict-popup-button dict-popup-button-' + cmd[0],
                track_hover: true,
                reactive: true,
            });
            btn.child = new St.Icon({
                style_class: 'dict-popup-button-icon dict-popup-button-icon-' + cmd[0],
                fallback_icon_name: 'help',
                icon_name: cmd[0],
            });

            let onClickId = btn.connect('clicked', (actor, event) => {
                this.visible = false;
                this.emit('iconbar-signals', cmd[1], cmd[2]);
                return Clutter.EVENT_PROPAGATE;
            });
            this._iconsBox.push([onClickId, btn]);
            this.add_child(btn);
        })
    }

    _iconBarEraser() {
        this._iconsBox.forEach(x => {
            if(x[0])
                x[1].disconnect(x[0]);
            x[0] = null;
            this.remove_child(x[1]);
            x[1].destroy();
        });
        this._iconsBox.length = 0;
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
        this._iconBarEraser();
        super.destroy();
    }
});

const DictPopup = GObject.registerClass(
class DictPopup extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.TOP);
        this.visible = false;
        this.style_class = 'dict-popup-boxpointer';
        Main.layoutManager.addChrome(this);

        this._panelClicked = false;
        this._keyboardToggle = false;
        this._notFound = false;
        this._pointerX = 0;
        this._pointerY = 0;
        this._selection = '';

        this._edit = new DictEditable();

        this._loadSettings();
        this._buildPopupPanel();
        this._bulidPopupBar();
        this._listenSelection(this._trigger);
    }

    _onWindowChanged() {
        this._hidePanel();
        this._iconBar.hide();
        // TODO: better app whitelist
    }

    _runCommand(tag, cmd) {
        let [popup, clip, type] = Array.from(tag, i => i === '1');
        let paste = cmd[0] === '@', command = cmd;
        if(paste) {
            command = cmd.substr(6);
            popup = false;
            clip = true;
        }
        if(type) {
            this._runWithEval(popup, clip, paste, command);
        } else {
            this._runWithBash(popup, clip, paste, command);
        }
    }

    _runWithBash(popup, clip, paste, cmd) {
        let title = global.display.get_focus_window().title;
        let rcmd = cmd.split('LDWORD').join(GLib.shell_quote(this._selection)).split('LDTITLE').join(GLib.shell_quote(title.toString()));
        try {
            if(popup|clip|paste) {
                let proc = new Gio.Subprocess({
                    argv: ['/bin/bash', '-c', rcmd],
                    flags: (Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE),
                });
                proc.init(null);
                let that = this, lines = [], line, read = (() => {
                    return function read_all(stream, exit) {
                        stream.read_line_async(GLib.PRIORITY_LOW, null, (source, res) => {
                            if((line = source.read_line_finish(res)) !== null && line[0] !== null) {
                                lines.push(ByteArray.toString(line[0]));
                                read_all(source, exit);
                            } else {
                                if(lines.length) {
                                    if(paste&exit) {
                                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, lines.join('\n'));
                                        that._edit.paste();
                                    } else {
                                        if(popup) {
                                            that._panelBox._info.set_text(lines.join('\n'));
                                            if(that._panelBox._word.visible)
                                                that._panelBox._word.set_text(that._selection);
                                            that._showPanel();
                                        }
                                        if(clip&exit) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, lines.join('\n'));
                                    }
                                } else {
                                    if(!exit) return;
                                    read_all(new Gio.DataInputStream({base_stream: proc.get_stderr_pipe()}), false);
                                }
                            }
                        });
                    }
                })();
                read(new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()}), true);
                proc.wait_check(null);
            } else {
                this._spawnWithGio(rcmd);
            }
        } catch (e) {
            Main.notifyError(APPNAME, e.message);
        }
    }

    _spawnWithGio(rcmd) {
        let proc = new Gio.Subprocess({
            argv: ['/bin/bash', '-c', rcmd],
            flags: (Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE)
        });
        proc.init(null);
        proc.wait_check(null);
    }

    _runWithEval(popup, clip, paste, cmd) {
        try {
            let LDWORD = this._selection;
            let LDTITLE = global.display.get_focus_window().title;
            let key = x => this._edit._stroke(x);
            if(paste) {
                let answer = eval(cmd).toString();
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, answer);
                this._edit.paste();
            } else if (popup|clip) {
                let answer = eval(cmd);
                if(popup) {
                    this._panelBox._info.set_text(answer.toString());
                    if(this._panelBox._word.visible)
                        this._panelBox._word.set_text(this._selection);
                    this._showPanel();
                }
                if(clip) St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, answer.toString());
            } else {
                eval(cmd);
            }
        } catch (e) {
            Main.notifyError(APPNAME, e.message);
        }
    }

    _buildPopupPanel() {
        this._dummyCursor = new St.Widget({ opacity: 0, reactive: true });
        this._dummyCursor.set_size(Math.round(40), Math.round(40));
        this.setPosition(this._dummyCursor, 0);
        this._addDummyCursor(this._sensitive);
        this._panelBox = new St.BoxLayout({
            style_class: 'dict-popup-content',
            vertical: true,
            visible: false,
            reactive: true,
        });

        this._leavePanelId = this._panelBox.connect('leave-event', this._hidePanel.bind(this));
        this._enterPanelId = this._panelBox.connect('enter-event', (actor, event) => {
            this._panelBox.visible = true;
            if(this._autohideDelayId)
                GLib.source_remove(this._autohideDelayId);
            if(this._logslevel === LOGSLEVEL.HOVER) this._recordLog();
            this._panelClicked = false;
        });
        this._clickPanelId = this._panelBox.connect('button-press-event', (actor, event) => {
            if(event.get_button() === 1 && this._ccommand)
                this._ccommand.split('#').forEach(x => {
                    try {
                        this._spawnWithGio(x.split('LDWORD').join(GLib.shell_quote(this._selection)));
                    } catch (e) {
                        Main.notifyError(APPNAME, 'Failed: ' + e.message);
                    }
                });
            switch(event.get_button()*!this._panelClicked) {
            case 1:
                if(this._logslevel === LOGSLEVEL.CLICK) this._recordLog();
                break;
            case 2:
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._panelBox._info.get_text());
                break;
            case 3:
                try {
                    this._spawnWithGio('gio open "' + this._openurl.replace('LDWORD', GLib.shell_quote(this._selection)) + '"');
                } catch (e) {
                    Main.notifyError(APPNAME, 'Failed to open: ' + e.message);
                }
                if(this._notFound) this._hidePanel();
                break;
            }
            this._panelClicked = true;
        });

        this._panelBox._word = new St.Label({style_class: 'dict-popup-word', visible: !this._hidetitle});
        this._panelBox._word.clutter_text.line_wrap = true;
        this._panelBox._word.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
        this._panelBox._word.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._panelBox.add_child(this._panelBox._word);

        this._panelBox._info = new St.Label({style_class: 'dict-popup-info'});
        this._panelBox._info.clutter_text.line_wrap = true;
        this._panelBox._info.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
        this._panelBox._info.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._panelBox.add_child(this._panelBox._info);

        this.bin.set_child(this._panelBox);
    }

    _bulidPopupBar() {
        this._iconBar = new DictIconBar();
        this._iconBarId = this._iconBar.connect('iconbar-signals', (area, tag, cmd) => {
            this._runCommand(tag, cmd);
        });

        Main.layoutManager.addChrome(this._iconBar);
        this._onWindowChangedId = global.display.connect('notify::focus-window', this._onWindowChanged.bind(this));
    }

    _listenSelection(tog) {
        switch(tog) {
        case TRIGGER.ICON:
            this._selectionChangedId = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY)
                    return;
                let FW = global.display.get_focus_window();
                if(this._whitelist === '*' || (FW && this._whitelist.split('#').indexOf(FW.wm_class) > -1)) {
                    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
                        if(!text) return;
                        [this._pointerX, this._pointerY] = global.get_pointer();
                        this._selection = this._textstrip ? text.trim() : text;
                        this._iconBar._showIconBar(this._pointerX, this._pointerY);
                    });
                }
            });
            break;
        case TRIGGER.AUTO:
            this._selectionChangedId = global.display.get_selection().connect('owner-changed', (sel, type, source) => {
                if(type != St.ClipboardType.PRIMARY)
                    return;
                let FW = global.display.get_focus_window();
                if(this._whitelist === '*' || (FW && this._whitelist.split('#').indexOf(FW.wm_class) > -1)) {
                    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) =>  {
                        if(!text) return;
                        [this._pointerX, this._pointerY] = global.get_pointer();
                        this._selection = this._textstrip ? text.trim() : text;
                        if(this._selection && (!this._filter || RegExp(this._filter, 'i').test(this._selection)))
                            this._lookUp(this._selection);
                    });
                }
            });
            break;
        default:
            break;
        }
    }

    _loadSettings() {
        this._fetchSettings();
        this._settingChangedId = gsettings.connect('changed', this._onSettingChanged.bind(this));
        if(this._shortcut)
            this._addKeyBindings();
    }

    _fetchSettings() {
        this._logslevel = gsettings.get_uint(Prefs.Fields.LOGSLEVEL);
        this._autohide  = gsettings.get_uint(Prefs.Fields.AUTOHIDE);
        this._trigger   = gsettings.get_uint(Prefs.Fields.TRIGGER);
        this._hidetitle = gsettings.get_boolean(Prefs.Fields.HIDETITLE);
        this._sensitive = gsettings.get_boolean(Prefs.Fields.SENSITIVE);
        this._shortcut  = gsettings.get_boolean(Prefs.Fields.SHORTCUT);
        this._textstrip = gsettings.get_boolean(Prefs.Fields.TEXTSTRIP);
        this._openurl   = gsettings.get_string(Prefs.Fields.OPENURL);
        this._dcommand  = gsettings.get_string(Prefs.Fields.DCOMMAND);
        this._ccommand  = gsettings.get_string(Prefs.Fields.CCOMMAND);
        this._filter    = gsettings.get_string(Prefs.Fields.FILTER);
        this._whitelist = gsettings.get_string(Prefs.Fields.WHITELIST);
    }

    _onSettingChanged() {
        if(gsettings.get_boolean(Prefs.Fields.SENSITIVE) != this._sensitive) {
            this._removeDummyCursor(this._sensitive);
            this._addDummyCursor(!this._sensitive);
        }
        let trigger = gsettings.get_uint(Prefs.Fields.TRIGGER);
        if(trigger != this._trigger) {
            if(this._selectionChangedId)
                global.display.get_selection().disconnect(this._selectionChangedId), this._selectionChangedId = 0;
            if(trigger === 0 || trigger === 2)
                this._listenSelection(trigger);
        }
        if(gsettings.get_boolean(Prefs.Fields.SHORTCUT) != this._shortcut) {
            Main.wm.removeKeybinding(Prefs.Fields.SHORTCUTNAME);
            if(!this._shortcut)
                this._addKeyBindings();
        }
        this._panelBox._word.visible = !gsettings.get_boolean(Prefs.Fields.HIDETITLE);
        this._fetchSettings();
    }

    _addDummyCursor(sen) {
        if(sen) {
            Main.layoutManager.uiGroup.add_actor(this._dummyCursor);
        } else {
            this._scrollId = this._dummyCursor.connect('scroll-event', this._hidePanel.bind(this));
            this._clickId = this._dummyCursor.connect('button-press-event', (actor, event) => {
                this._hidePanel();
                if(event.get_button() === 3)
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._selection);
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
        Main.wm.addKeybinding(Prefs.Fields.SHORTCUTNAME, gsettings, Meta.KeyBindingFlags.NONE, ModeType.ALL, () => {
            St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
                if(!text) return;
                [this._pointerX, this._pointerY] = global.get_pointer();
                this._selection = this._textstrip ? text.trim() : text;
                this._lookUp(this._selection);
            });
        });
    }

    _lookUp(text) {
        try {
            let rcmd = this._dcommand.split('LDWORD').join(GLib.shell_quote(text));
            let proc = new Gio.Subprocess({
                argv: ['/bin/bash', '-c', rcmd],
                flags: (Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE),
            });
            proc.init(null);
            // so-called Y combinator
            // var Y = gen => (f => f(f)) (f => gen (x => f(f)(x)));
            let that = this, lines = [], line, read = (() => {
                return function read_all(stream, exit) {
                    stream.read_line_async(GLib.PRIORITY_LOW, null, (source, res) => {
                        if((line = source.read_line_finish(res)) !== null && line[0] !== null) {
                            lines.push(ByteArray.toString(line[0]));
                            read_all(source, exit);
                        } else {
                            if(lines.length) {
                                that._panelBox._info.set_text(lines.join('\n'));
                                if(that._panelBox._word.visible)
                                    that._panelBox._word.set_text(text);
                                that._showPanel();
                                that._notFound = !exit;
                                if(that._logslevel === LOGSLEVEL.ALWAYS) that._recordLog();
                            } else {
                                if(!exit) return;
                                read_all(new Gio.DataInputStream({base_stream: proc.get_stderr_pipe()}), false);
                            }
                        }
                    });
                }
            })();
            read(new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()}), true);
            proc.wait_check(null);
        } catch (e) {
            Main.notifyError(APPNAME, e.message);
        }
    }

    _hidePanel() {
        if(!this._panelBox.visible)
            return;
        this._panelBox.visible = false
        this.close(BoxPointer.PopupAnimation.FULL);
        let [X, Y] = global.display.get_size();
        this._dummyCursor.set_position(X, Y);
    }

    _showPanel() {
        this._dummyCursor.set_position(this._pointerX - 20, this._pointerY - 20);
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
        if(this._trigger != TRIGGER.AUTO) return;
        let logfile = Gio.file_new_for_path(GLib.get_home_dir()+ '/.cache/gnome-shell-extension-light-dict/light-dict.log');
        try {
            logfile.append_to(Gio.FileCreateFlags.NONE, null).write([Date.now(), this._selection, this._notFound ? 0 : 1].join('\t') + '\n', null);
        } catch (e) {
            Main.notifyError(APPNAME, e.message);
        }
    }

    destory() {
        if(this._autohideDelayId)
            GLib.source_remove(this._autohideDelayId), this._autohideDelayId = 0;
        if(this._selectionChangedId)
            global.display.get_selection().disconnect(this._selectionChangedId), this._selectionChangedId = 0;
        if(this._enterPanelId)
            this._panelBox.disconnect(this._enterPanelId), this._enterPanelId = 0;
        if(this._leavePanelId)
            this._panelBox.disconnect(this._leavePanelId), this._leavePanelId = 0;
        if(this._clickPanelId)
            this._panelBox.disconnect(this._clickPanelId), this._clickPanelId = 0;
        if(this._iconBarId)
            this._iconBar.disconnect(this._iconBarId), this._iconBarId = 0;
        if(this._shortcut)
            Main.wm.removeKeybinding(Prefs.Fields.SHORTCUTNAME);
        if(this._onWindowChangedId)
            global.display.disconnect(this._onWindowChangedId), this._onWindowChangedId = 0;
        if(this._settingChangedId)
            gsettings.disconnect(this._settingChangedId), this._settingChangedId = 0;

        this._removeDummyCursor();
        Main.layoutManager.removeChrome(this._iconBar);
        this._iconBar.destory();
        this._panelBox.destroy();
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }
});

const DictEditable = GObject.registerClass(
class DictEditable extends GObject.Object {
    _init() {
        super._init();
        if (Atspi.init() === 2) {
            this.destroy();
            throw new Error('Failed to start AT-SPI');
        }

        this._modifiers = { Alt_L: 0x40, Control_L: 0x25, Shift_L: 0x32, Super_L: 0x85 };
    }

    _isMoififiers(keyname) {
        return Object.keys(this._modifiers).indexOf(keyname) > -1;
    }

    _release(keyname) {
        if(!this._isMoififiers(keyname))
            return;
        Atspi.generate_keyboard_event(
            this._modifiers[keyname],
            null,
            Atspi.KeySynthType.RELEASE
        );
    }

    _press(keyname) {
        if(this._isMoififiers(keyname)) {
            Atspi.generate_keyboard_event(
                this._modifiers[keyname],
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
                setTimeout(() => {
                    let keyarray = keys.split('+');
                    keyarray.forEach(key => this._press(key));
                    keyarray.slice().reverse().forEach(key => this._release(key));
                }, i * 100);
            });
        } catch (e) {
            Main.notifyError(APPNAME, e.message);
        }
    }

    paste() {
        this._stroke('Control_L+v');
    }

    cut() {
        this._stroke('Control_L+x');
    }

    destroy() {
        try {
            Atspi.exit();
        } catch (e) {
            // Silence errors
        }
    }
});

const LightDict = GObject.registerClass(
class LightDict extends GObject.Object {
    _init() {
        super._init();
        let logfilePath = Gio.file_new_for_path(GLib.get_home_dir()+ '/.cache/gnome-shell-extension-light-dict/');
        if(!logfilePath.query_exists(null))
            logfilePath.make_directory(Gio.Cancellable.new());
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

