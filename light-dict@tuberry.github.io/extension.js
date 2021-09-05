// vim:fdm=syntax
// by tuberry
'use strict';

const Main = imports.ui.main;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const Keyboard = imports.ui.status.keyboard;
const ExtensionUtils = imports.misc.extensionUtils;
const { Meta, Shell, Clutter, IBus, Gio, GLib, GObject, St, Pango, Gdk } = imports.gi;

const InputSources = Keyboard.getInputSourceManager();
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.fields.Fields;
const _ = ExtensionUtils.gettext;

const g_pointer = () => global.get_pointer();
const g_size = () => global.display.get_size();
const g_focus = () => global.display.focus_window;
const getIcon = x => Me.dir.get_child('icons').get_child(x + '-symbolic.svg').get_path();

const Trigger = { Swift: 0, Popup: 1, Disable: 2 };
const OCRMode = { Word: 0, Paragraph: 1, Area: 2, Selection: 3, Line: 4, Button: 5 };
const MODIFIERS = Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SHIFT_MASK;
const LD_DBUS_IFACE = `
<node>
    <interface name="org.gnome.Shell.Extensions.LightDict">
        <method name="Block"/>
        <method name="Toggle"/>
        <method name="Run">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
        </method>
        <method name="RunAt">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
            <arg type="i" direction="in" name="x"/>
            <arg type="i" direction="in" name="y"/>
            <arg type="i" direction="in" name="width"/>
            <arg type="i" direction="in" name="height"/>
        </method>
        <property name="Pointer" type="au" access="read"/>
        <property name="DisplaySize" type="au" access="read"/>
        <property name="FocusWindow" type="au" access="read"/>
    </interface>
</node>`;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const DictBar = GObject.registerClass({
    Properties: {
        'tooltips': GObject.ParamSpec.boolean('tooltips', 'tooltips', 'tooltips', GObject.ParamFlags.WRITABLE, false),
        'pagesize': GObject.ParamSpec.uint('pagesize', 'pagesize', 'page zise', GObject.ParamFlags.READWRITE, 1, 10, 5),
        'autohide': GObject.ParamSpec.uint('autohide', 'autohide', 'auto hide', GObject.ParamFlags.READWRITE, 500, 10000, 2500),
        // 'pcommands': GObject.ParamSpec.jsobject('pcommands', 'pcommands', 'pcommands', GObject.ParamFlags.WRITABLE, []), // NOTE: need mapping
    },
    Signals: {
        'dict-bar-clicked': { param_types: [GObject.TYPE_JSOBJECT] },
    },
}, class DictBar extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer candidate-popup-boxpointer';
        Main.layoutManager.addTopChrome(this);

        this._pages = 1;
        this._index = 1;

        this._buildWidgets();
        this._bindSettings();
    }

    _buildWidgets() {
        this._box = new St.BoxLayout({
            visible: false,
            reactive: true,
            vertical: false,
            style_class: 'light-dict-iconbox candidate-popup-content',
        });
        this.bin.set_child(this._box);

        this._box.connect('leave-event', this._onLeave.bind(this));
        this._box.connect('enter-event', this._onEnter.bind(this));
        this._box.connect('scroll-event', this._onScroll.bind(this));
    }

    _bindSettings() {
        // gsettings.bind_with_mapping(Fields.PCOMMANDS, this, 'pcommands', Gio.SettingsBindFlags.GET); // NOTE: unavailable
        gsettings.bind(Fields.TOOLTIP,  this, 'tooltips', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.PAGESIZE, this, 'pagesize', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.AUTOHIDE, this, 'autohide', Gio.SettingsBindFlags.GET);
        this.pcommands = gsettings.get_strv(Fields.PCOMMANDS);
        this.pcommandsId = gsettings.connect('changed::' + Fields.PCOMMANDS, () => { this.pcommands = gsettings.get_strv(Fields.PCOMMANDS); });
    }

    set tooltips(tooltips) {
        if(tooltips) {
            if(this._tooltip) return;
            this._tooltip = new St.Label({
                visible: false,
                style_class: 'light-dict-tooltip dash-label',
            });
            Main.layoutManager.addTopChrome(this._tooltip);
        } else {
            if(!this._tooltip) return;
            this._tooltip.destroy();
            delete this._tooltip;
        }
    }

    set pcommands(commands) {
        this._index = 1;
        this._box.destroy_all_children();
        commands.forEach(x => this._iconMaker(x));
    }

    get _icons() {
        return this._box.get_children();
    }

    _onScroll(actor, event) {
        if(this._tooltip) this._tooltip.hide();
        this._icons.forEach(x => x.entered = false);
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this._index--; break;
        case Clutter.ScrollDirection.DOWN: this._index++; break;
        }
        this._updatePages();
    }

    _onEnter() {
        if(this._delayId)
            GLib.source_remove(this._delayId), this._delayId = 0;
        this._box.visible = true;
    }

    _onLeave(actor) {
        if(this._delayId)
            GLib.source_remove(this._delayId), this._delayId = 0;
        this._delayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, actor ? this.autohide / 10 : this.autohide, () => {
            this._hide();
            this._delayId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updatePages() {
        this._icons.forEach(x => x.visible = x._visible);
        let icons = this._icons.filter(x => x._visible);
        this._pages = (icons.length && this.pagesize) ? Math.ceil(icons.length / this.pagesize) : 0;
        if(this._pages < 2) return;
        this._index = this._index < 1 ? this._pages : (this._index > this._pages ? 1 : this._index);
        if(this._index === this._pages && icons.length % this.pagesize) {
            icons.forEach((x, i) => { x.visible = i >= icons.length - this.pagesize && i < icons.length; });
        } else {
            icons.forEach((x, i) => { x.visible = i >= (this._index - 1) * this.pagesize && i < this._index * this.pagesize; });
        }
    }

    _updateVisible(app, text) {
        this._icons.forEach(x => {
            switch((!!x.apps << 1) + !!x.regexp) {
            case 0: x._visible = true; break;
            case 1: x._visible = RegExp(x.regexp).test(text); break;
            case 2: x._visible = x.apps.includes(app); break;
            case 3: x._visible = x.apps.includes(app) && RegExp(x.regexp).test(text); break;
            }
        });
        this._updatePages();
    }

    _iconMaker(cmd) {
        let x = JSON.parse(cmd);
        if(!x.enable) return;
        let btn = new St.Button({
            style_class: 'light-dict-button candidate-box',
        });
        btn.child = new St.Icon({
            icon_name: x.icon || 'help',
            fallback_icon_name: 'help',
            style_class: 'light-dict-button-icon candidate-label',
        });
        Object.assign(btn, x);
        btn.connect('clicked', (actor, event) => {
            this._hide();
            this.emit('dict-bar-clicked', x);
            return Clutter.EVENT_STOP;
        });
        btn.connect('enter-event', () => {
            if(!this._tooltip) return;
            btn.entered = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.autohide / 2, () => {
                if(!btn.entered || !this._box.visible) return GLib.SOURCE_REMOVE;
                this._tooltip.set_position(g_pointer()[0], this.get_position()[1] + this.get_size()[1] + 5);
                this._tooltip.set_text(x.tooltip || x.icon || 'tooltip');
                this._tooltip.show();
                return GLib.SOURCE_REMOVE;
            });
        });
        btn.connect('leave-event', () => {
            if(!this._tooltip) return;
            btn.entered = false;
            this._tooltip.hide();
        });
        btn._visible = true;
        this._box.add_child(btn);
    }

    _show(fw, text) {
        this._hide();
        this._updateVisible(fw, text);
        if(this._pages < 1) return;
        if(!this._box.visible) {
            this._box.visible = true;
            this.open(BoxPointer.PopupAnimation.NONE);
            this.get_parent().set_child_above_sibling(this, null);
        }

        this._onLeave();
    }

    _hide() {
        if(!this._box.visible) return;

        this._box.visible = false;
        this.close(BoxPointer.PopupAnimation.NONE);
        if(this._tooltip) this._tooltip.hide();
    }

    destroy() {
        if(this._delayId)
            GLib.source_remove(this._delayId), this._delayId = 0;
        if(this.pcommandsId)
            gsettings.disconnect(this.pcommandsId), this.pcommandsId = 0;

        this.tooltips = false;
        super.destroy();
    }
});

const DictBox = GObject.registerClass({
    Properties: {
        'lcommand': GObject.ParamSpec.string('lcommand', 'lcommand', 'l command', GObject.ParamFlags.READWRITE, ''),
        'rcommand': GObject.ParamSpec.string('rcommand', 'rcommand', 'r command', GObject.ParamFlags.READWRITE, ''),
        'autohide': GObject.ParamSpec.uint('autohide', 'autohide', 'auto hide', GObject.ParamFlags.READWRITE, 500, 10000, 2500),
    },
}, class DictBox extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.TOP);
        this.visible = false;
        this.style_class = 'light-dict-box-boxpointer candidate-popup-boxpointer';
        Main.layoutManager.addTopChrome(this);

        this._selection = '';
        this._bindSettings();
        this._buildWidgets();
    }

    _buildWidgets() {
        this._view = new St.ScrollView({
            visible: false,
            overlay_scrollbars: true,
            style_class: 'light-dict-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
        });

        this._box = new St.BoxLayout({
            reactive: true,
            vertical: true,
            style_class: 'light-dict-content',
        });

        this._text = new St.Label({ style_class: 'light-dict-text' });
        this._text.clutter_text.line_wrap = true;
        this._info = new St.Label({ style_class: 'light-dict-info' });
        this._info.clutter_text.line_wrap = true;

        this._box.add_child(this._text);
        this._box.add_child(this._info);
        this._view.add_actor(this._box);
        this.bin.set_child(this._view);

        this._box.connect('leave-event', this._onLeave.bind(this));
        this._box.connect('enter-event', this._onEnter.bind(this));
        this._box.connect('button-press-event', this._onClick.bind(this));
        gsettings.bind(Fields.HIDETITLE, this._text, 'visible', Gio.SettingsBindFlags.INVERT_BOOLEAN);
    }

    _bindSettings() {
        gsettings.bind(Fields.AUTOHIDE, this, 'autohide', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.LCOMMAND, this, 'lcommand', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.RCOMMAND, this, 'rcommand', Gio.SettingsBindFlags.GET);
    }

    get _scrollable() {
        let [, height] = this._view.get_preferred_height(-1);
        let maxHeight = this._view.get_theme_node().get_max_height();
        if(maxHeight < 0) maxHeight = g_size()[1] * 15 / 32;

        return height >= maxHeight;
    }

    _onEnter() {
        this._view.visible = true;
        if(this._delayId) GLib.source_remove(this._delayId), this._delayId = 0;
    }

    _onClick(actor, event) {
        switch(event.get_button()) {
        case 1: if(this.lcommand) Util.spawnCommandLine(this.lcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
        case 2: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._info.get_text()); break;
        case 3: if(this.rcommand) Util.spawnCommandLine(this.rcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); this._hide(); break;
        }
    }

    _onLeave(actor) {
        let [mx, my] = g_pointer();
        let [wt, ht] = this.get_transformed_size();
        let [px, py] = this.get_transformed_position();
        let duration = actor === undefined ? this.autohide : this.autohide / 10;
        let callback = mx < px || my < py || mx > px + wt || my > py + ht ? () => {
            this._delayId = 0;
            this._hide();
            return GLib.SOURCE_REMOVE;
        } : () => { return this._onLeave(true); }

        if(this._delayId)
            GLib.source_remove(this._delayId), this._delayId = 0;
        this._delayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, callback);

        return GLib.SOURCE_REMOVE;
    }

    _hide() {
        if(!this._view.visible) return;

        this._view.visible = false;
        this._info.set_text('ヽ(ー_ー)ノ');
        this.close(BoxPointer.PopupAnimation.NONE);
    }

    _show(info, text) {
        this._selection = text;

        try {
            Pango.parse_markup(info, -1, '');
            this._info.clutter_text.set_markup(info || 'Σ(ʘωʘﾉ)ﾉ');
        } catch(e) {
            this._info.set_text(info || 'o(T^T)o');
        }
        if(this._text.visible) this._text.set_text(text);

        if(this._scrollable) {
            this._view.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this._view.vscroll.get_adjustment().set_value(0);
        } else {
            this._view.vscrollbar_policy = St.PolicyType.NEVER;
        }

        if(!this._view.visible) {
            this._view.visible = true;
            this.open(BoxPointer.PopupAnimation.NONE);
            this.get_parent().set_child_above_sibling(this, null);
        }

        this._onLeave();
    }

    destroy() {
        if(this._delayId)
            GLib.source_remove(this._delayId), this._delayId = 0;

        super.destroy();
    }
});

const DictAct = GObject.registerClass({
    Properties: {
        'ocr-mode':   GObject.ParamSpec.uint('ocr-mode', 'ocr-mode', 'ocr mode', GObject.ParamFlags.READWRITE, 0, 5, 0),
        'ocr-params': GObject.ParamSpec.string('ocr-params', 'ocr-params', 'ocr params', GObject.ParamFlags.READWRITE, ''),
        'enable-ocr': GObject.ParamSpec.boolean('enable-ocr', 'enable-ocr', 'enable ocr', GObject.ParamFlags.WRITABLE, false),
    },
}, class DictAct extends GObject.Object {
    _init() {
        super._init();
        this._bindSettings();
        let seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    _bindSettings() {
        gsettings.bind(Fields.ENABLEOCR, this, 'enable-ocr', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.OCRMODE,   this, 'ocr-mode',   Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.OCRPARAMS, this, 'ocr-params', Gio.SettingsBindFlags.GET);
    }

    set ocr_mode(mode) {
        this._ocr_mode = Object.keys(OCRMode)[mode].toLowerCase();
    }

    set enable_ocr(enable) {
        if(enable) {
            Main.wm.addKeybinding(Fields.OCRSHORTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this._invokeOCR.bind(this));
        } else {
            Main.wm.removeKeybinding(Fields.OCRSHORTCUT);
        }
    }

    set screenshot(screenshot) {
        if(global.context?.unsafe_mode ?? true) return;
        let checker = Main.shellDBusService._screenshotService._senderChecker;
        checker._isSenderAllowed = screenshot ? () => true :
            sender => [...checker._allowlistMap.values()].includes(sender);
    }

    _invokeOCR() {
        this.screenshot = true;
        let cmd = Me.dir.get_child('ldocr.py').get_path();
        let params = this.ocr_params + ' -m ' + this._ocr_mode;
        this.execute(['python', cmd, params].join(' ')).then(null).catch(null)
            .finally(() => { this.screenshot = false; });
    }

    _release(keyname) {
        this._keyboard.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(keyname), Clutter.KeyState.RELEASED);
    }

    _press(keyname) {
        this._keyboard.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(keyname), Clutter.KeyState.PRESSED);
    }

    stroke(keystring) {
        keystring.split(/\s+/).forEach((keys, i) => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, i * 100, () => {
                let keyarray = keys.split('+');
                keyarray.forEach(key => this._press(key));
                keyarray.slice().reverse().forEach(key => this._release(key));
                return GLib.SOURCE_REMOVE;
            });
        }); // NOTE: Modifier keys aren't working on Wayland (input area)
    }

    commit(string) {
        if(InputSources.currentSource.type == Keyboard.INPUT_SOURCE_TYPE_IBUS) {
            if(InputSources._ibusManager._panelService)
                InputSources._ibusManager._panelService.commit_text(IBus.Text.new_from_string(string));
        } else {
            Main.inputMethod.commit(string); // TODO: not tested
        }
    }

    copy(string) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, string);
    }

    select(string) {
        St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, string);
    }

    async execute(cmd) {
        let proc = new Gio.Subprocess({
            argv: GLib.shell_parse_argv(cmd)[1],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if(proc.get_exit_status()) throw new Error(stderr.trim());

        return stdout.trim();
    }

    destroy() {
        this.screenshot = false;
        this.enable_ocr = false;
        delete this._keyboard;
    }
});

const DictBtn = GObject.registerClass({
    Properties: {
        'passive':    GObject.ParamSpec.uint('passive', 'passive', 'passive', GObject.ParamFlags.READWRITE, 0, 1, 0),
        'trigger':    GObject.ParamSpec.uint('trigger', 'trigger', 'trigger', GObject.ParamFlags.READWRITE, 0, 2, 1),
        'ocr-mode':   GObject.ParamSpec.uint('ocr-mode', 'ocr-mode', 'ocr mode', GObject.ParamFlags.READWRITE, 0, 5, 0),
        'enable-ocr': GObject.ParamSpec.boolean('enable-ocr', 'enable-ocr', 'enable ocr', GObject.ParamFlags.WRITABLE, false),
    },
    Signals: {
        'add-or-remove-app': {},
    },
}, class DictBtn extends PanelMenu.Button {
    _init(params) {
        super._init(params);

        this._buildWidgets();
        this._bindSettings();
    }

    _buildWidgets() {
        this._icon = new St.Icon({ style_class: 'light-dict-systray system-status-icon', });
        this.add_actor(this._icon);
    }

    _bindSettings() {
        gsettings.bind(Fields.ENABLEOCR, this, 'enable-ocr', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.PASSIVE,   this, 'passive',    Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.TRIGGER,   this, 'trigger',    Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.OCRMODE,   this, 'ocr-mode',   Gio.SettingsBindFlags.GET);
        this._inited = true;
        this._updateMenu();
    }

    set passive(passive) {
        this._passive = passive;
        this._setIcon();
    }

    set trigger(trigger) {
        this._trigger = trigger;
        this._setIcon();
    }

    set ocr_mode(ocr_mode) {
        if(!this._enable_ocr) return;
        this._ocr_mode = ocr_mode;
        this._updateMenu();
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable;
        this._updateMenu();
    }

    get _icon_name() {
        switch(this._trigger) {
        case Trigger.Popup: return this._passive == 1 ? 'popup-passive' : 'popup-proactive';
        case Trigger.Swift: return this._passive == 1 ? 'swift-passive' : 'swift-proactive';
        default: return this._passive == 1 ? 'disable-passive' : 'disable-proactive';
        }
    }

    vfunc_scroll_event(event) {
        switch(event.direction) {
        case Clutter.ScrollDirection.UP: gsettings.set_uint(Fields.TRIGGER, (this._trigger + 1) % 2); break;
        case Clutter.ScrollDirection.DOWN: gsettings.set_uint(Fields.PASSIVE, 1 - this._passive); break;
        }
        return Clutter.EVENT_STOP;
    };

    _setIcon() {
        if(this._trigger === undefined || this._passive === undefined) return;
        this._icon.set_gicon(new Gio.FileIcon({ file: Gio.File.new_for_path(getIcon(this._icon_name)) }));
        this._updateMenu();
    }

    get scommands() {
        return gsettings.get_strv(Fields.SCOMMANDS);
    }

    _scommandsMenu() {
        let commands = this.scommands.map(x => JSON.parse(x));
        let index = commands.findIndex(x => !!x.enable);
        let scommand = new PopupMenu.PopupSubMenuMenuItem(_('Swift: ') + (index < 0 ? '' : commands[index].name));
        commands.forEach((x, i) => {
            let item = new PopupMenu.PopupMenuItem(x.name);
            i == index ? item.setOrnament(PopupMenu.Ornament.DOT) : item.connect('activate', item => {
                item._getTopMenu().close();
                gsettings.set_int(Fields.SCOMMAND, i);
                gsettings.set_strv(Fields.SCOMMANDS, commands.map((x, j) =>
                    JSON.stringify(Object.assign(x, { enable: i == j || undefined }), null, 0)));
            });
            scommand.menu.addMenuItem(item);
        });

        return scommand;
    }

    _triggerMenu() {
        let trigger = new PopupMenu.PopupSubMenuMenuItem(_('Trigger: ') + _(Object.keys(Trigger)[this._trigger]));
        Object.keys(Trigger).forEach(x => {
            let item = new PopupMenu.PopupMenuItem(_(x), { style_class: 'light-dict-item popup-menu-item' });
            item.setOrnament(this._trigger == Trigger[x] ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', item => { item._getTopMenu().close(); gsettings.set_uint(Fields.TRIGGER, Trigger[x]); });
            trigger.menu.addMenuItem(item);
        });

        return trigger;
    }

    _OCRModeMenu() {
        let ocr_mode = new PopupMenu.PopupSubMenuMenuItem(_('OCR: ') + _(Object.keys(OCRMode)[this._ocr_mode]));
        Object.keys(OCRMode).forEach(x => {
            let item = new PopupMenu.PopupMenuItem(_(x), { style_class: 'light-dict-item popup-menu-item' });
            item.setOrnament(this._ocr_mode == OCRMode[x] ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => { item._getTopMenu().close(); gsettings.set_uint(Fields.OCRMODE, OCRMode[x]); });
            ocr_mode.menu.addMenuItem(item);
        });

        return ocr_mode;
    }

    _menuSwitchMaker(text, active, callback) {
        let item = new PopupMenu.PopupSwitchMenuItem(text, active, { style_class: 'light-dict-item popup-menu-item' });
        item.connect('activate', callback);

        return item;
    }

    _menuItemMaker(text, callback) {
        let item = new PopupMenu.PopupMenuItem(text, { style_class: 'light-dict-item popup-menu-item' });
        item.connect('activate', callback);

        return item;
    }

    _updateMenu() {
        if(!this._inited) return;
        this.menu.removeAll();
        this.menu.addMenuItem(this._menuSwitchMaker(_('Passive mode'), !!this._passive, item => {
            item._getTopMenu().close(); gsettings.set_uint(Fields.PASSIVE, !this._passive); }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._triggerMenu());
        this.menu.addMenuItem(this._scommandsMenu());
        if(this._enable_ocr) this.menu.addMenuItem(this._OCRModeMenu());
        this.menu.addMenuItem(this._menuItemMaker(_('Add/remove current app'), () => { this.emit('add-or-remove-app'); }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._menuItemMaker(_('Settings'), () => { ExtensionUtils.openPrefs(); }));
    }
});

const LightDict = GObject.registerClass({
    Properties: {
        'filter':     GObject.ParamSpec.string('filter', 'filter', 'filter', GObject.ParamFlags.READWRITE, ''),
        'app-list':   GObject.ParamSpec.string('app-list', 'app-list', 'app list', GObject.ParamFlags.READWRITE, ''),
        'systray':    GObject.ParamSpec.boolean('systray', 'systray', 'systray', GObject.ParamFlags.WRITABLE, true),
        'passive':    GObject.ParamSpec.uint('passive', 'passive', 'passive', GObject.ParamFlags.READWRITE, 0, 1, 0),
        'trigger':    GObject.ParamSpec.uint('trigger', 'trigger', 'trigger', GObject.ParamFlags.READWRITE, 0, 2, 1),
        'list-type':  GObject.ParamSpec.uint('list-type', 'list-type', 'list type', GObject.ParamFlags.READWRITE, 0, 1, 1),
        'text-strip': GObject.ParamSpec.boolean('text-strip', 'text-strip', 'strip text', GObject.ParamFlags.READWRITE, true),
        'scommand':   GObject.ParamSpec.int('scommand', 'scommand', 'swift command', GObject.ParamFlags.READWRITE, -1, 2000, 0),
    },
}, class LightDict extends GObject.Object {
    _init() {
        super._init();
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);

        this._selection = '';
        this._app = this.appid;

        this._bindSettings();
        this._buildWidgets();
    }

    _bindSettings() {
        gsettings.bind(Fields.APPLIST,   this, 'app-list',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,   this, 'trigger',    Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SYSTRAY,   this, 'systray',    Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.TXTFILTER, this, 'filter',     Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.LISTTYPE,  this, 'list-type',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.PASSIVE,   this, 'passive',    Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.TEXTSTRIP, this, 'text-strip', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.SCOMMAND,  this, 'scommand',   Gio.SettingsBindFlags.GET);
        this.scommands = gsettings.get_strv(Fields.SCOMMANDS);
        this.scommandsId = gsettings.connect('changed::' + Fields.SCOMMANDS, () => { this.scommands = gsettings.get_strv(Fields.SCOMMANDS); });
    }

    _buildWidgets() {
        this._act = new DictAct();
        this._box = new DictBox();
        this._bar = new DictBar();

        this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_DBUS_IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');

        this._bar.connect('dict-bar-clicked', (actor, cmd) => { this._exeCmd(cmd); });
        this._onWindowChangedId = global.display.connect('notify::focus-window', this._onWindowChanged.bind(this));
        this._onSelectChangedId = global.display.get_selection().connect('owner-changed', this._onSelectChanged.bind(this));
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new DictBtn(null, Me.metadata.uuid);
            this._button.connect('add-or-remove-app', this.Block.bind(this));
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button);
        } else {
            if(!this._button) return;
            this._button.destroy();
            delete this._button;
        }
    }

    set scommands(cmds) {
        this._scmd = JSON.parse(cmds[this.scommand] || cmds[0] || 'null');
        if(this._button) this._button._updateMenu();
    }

    get _allow() {
        return !this.app_list || this.list_type ^ this.app_list.includes(this._app);
    }

    get appid() {
        return (v => v ? (w => w.is_window_backed() ? '' : w.get_id())
                (Shell.WindowTracker.get_default().get_window_app(v)) : '')(g_focus());
    }

    set cursor(cursor) {
        let [x, y, w, h] = cursor && cursor[3] < g_size()[1] / 2 ? cursor :
            ((a, b) => [a[0] - b / 2, a[1] - b / 2, b, b])(g_pointer(), Meta.prefs_get_cursor_size());
        this._cursor = !!cursor && w > 250;
        this._cur.set_position(x, y);
        this._cur.set_size(w, h);
    }

    _onWindowChanged() {
        this._box._hide();
        this._bar._hide();
        this._app = this.appid;
    }

    _onSelectChanged(sel, type, src) {
        if(type != St.ClipboardType.PRIMARY) return;
        if(this._mouseReleasedId)
            GLib.source_remove(this._mouseReleasedId), this._mouseReleasedId = 0;
        if(this._block) { this._block = undefined; return; }
        if(!this._allow || this.trigger == Trigger.Disable) return;
        let initModifier = g_pointer()[2];
        if(this.passive == 1 && (initModifier & MODIFIERS) == 0) return;
        if(initModifier & Clutter.ModifierType.BUTTON1_MASK) {
            this._mouseReleasedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                let tmpModifier = g_pointer()[2];
                if((initModifier ^ tmpModifier) == Clutter.ModifierType.BUTTON1_MASK) {
                    this._mouseReleasedId = 0;
                    this._run();
                    return GLib.SOURCE_REMOVE;
                } else {
                    return GLib.SOURCE_CONTINUE;
                }
            }); // NOTE: `owner-changed` is emitted every char in Gtk+ apps
        } else {
            this._run();
        }
    }

    _exeSh(cmd, pop, cpy, cmt, sel) {
        let rcmd = cmd.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/APPID/g, GLib.shell_quote(this._app));
        if(pop|cpy|cmt|sel) {
            this._act.execute(rcmd).then(scc => {
                if(sel) this._select(scc);
                if(cpy) this._act.copy(scc);
                if(cmt) this._act.commit(scc);
                if(pop) this._display(scc);
            }).catch(err => {
                this._display(err.message);
            });
        } else {
            Util.spawnCommandLine(rcmd);
        }
    }

    _exeJS(cmd, pop, cpy, cmt, sel) {
        try {
            let APPID = this._app;
            let LDWORD = this._selection;
            let key = x => this._act.stroke(x);
            let copy = x => this._act.copy(x);
            let select = x => this._select(x);
            let commit = x => this._act.commit(x);
            if(pop|cpy|cmt|sel) {
                let result = eval(cmd).toString();
                if(cpy) copy(result);
                if(cmt) commit(result);
                if(sel) select(result);
                if(pop) this._display(result);
            } else {
                eval(cmd);
            }
        } catch(e) {
            this._display(e.message);
        }
    }

    _exeCmd(p) {
        (q => p.type ? this._exeJS(...q) : this._exeSh(...q))([p.command, p.popup, p.copy, p.commit, p.select]);
    }

    _select(x) {
        this._block = true;
        this._act.select(x);
    }

    _swift() {
        if(!this._scmd) return;
        if(this._scmd.apps && !this._scmd.apps.includes(this._app)) return;
        if(this._scmd.regexp && !RegExp(this._scmd.regexp).test(this._selection)) return;
        this._exeCmd(this._scmd);
    }

    _popup() {
        this._box._hide();
        this._bar.setPosition(this._cur, 1 / 2);
        this._bar._show(this._app, this._selection);
    }

    _display(info) {
        this._box._hide();
        this._box.setPosition(this._cur, this._cursor ? 1 / 2 : 0);
        this._box._show(info, this._selection);
    }

    _store(text) {
        let selection = this.text_strip ? text.replace(/\n\s*\n/g, '\r') : text;
        if(!selection) throw new Error('Empty string');
        this._selection = selection.replace(/\n/g, '\r'); // shell args
    }

    async _fetch() {
        return await new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (clip, text) => {
                               if(text) resolve(text); else throw new Error('Empty string'); }));
    }

    async _run(type, text, info, cursor) {
        this.cursor = cursor;
        if(type === undefined) {
            this._store(await this._fetch());
            if(this.passive == 0 && this.filter && !RegExp(this.filter).test(this._selection)) return;
            this.trigger ? this._popup() : this._swift();
        } else {
            switch(type == 'auto' ? (this.trigger ? 'swift' : 'popup') : type) {
            case 'swift': this._store(text || await this._fetch()); this._swift(); break;
            case 'popup': this._store(text || await this._fetch()); this._popup(); break;
            default: this._store(text || 'Void'); this._display(info.trim() || '_(:з」∠)_'); break;
            }
        }
    }

    async Run(type, text, info) {
        await this._run(type, text, info);
    }

    async RunAt(type, text, info, x, y, w, h) {
        await this._run(type, text, info, [x, y, w, h]);
    }

    Toggle() {
        let next = (this.trigger + 1) % 2;
        Main.notify(Me.metadata.name, _('Switch to %s style').format(_(Object.keys(Trigger)[next])));
        this.trigger = next;
    }

    Block() {
        if(!this._app) return;
        if(!this.app_list) {
            this.app_list = this._app;
        } else {
            let apps = this.app_list.split(',');
            this.app_list.includes(this._app) ? apps.splice(apps.indexOf(this._app), 1) : apps.push(this._app);
            this.app_list = apps.join(',');
        }
    }

    get Pointer() {
        return g_pointer().slice(0, 2);
    }

    get DisplaySize() {
        return g_size();
    }

    get FocusWindow() {
        return (w => w ? (r => [r.x, r.y, r.width, r.height])(w.get_frame_rect()) : null)(g_focus());
    }

    destroy() {
        if(this.scommandsId)
            gsettings.disconnect(this.scommandsId), this.scommandsId = 0;
        if(this._mouseReleasedId)
            GLib.source_remove(this._mouseReleasedId), this._mouseReleasedId = 0;
        if(this._onWindowChangedId)
            global.display.disconnect(this._onWindowChangedId), this._onWindowChangedId = 0;
        if(this._onSelectChangedId)
            global.display.get_selection().disconnect(this._onSelectChangedId), this._onSelectChangedId = 0;

        this.systray = false;
        this._dbus.flush();
        this._dbus.unexport();
        this._bar.destroy();
        this._box.destroy();
        this._act.destroy();
        this._cur.destroy();
        delete this._dbus;
        delete this._bar;
        delete this._box;
        delete this._act;
        delete this._cur;
    }
});

const Extension = class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._dict = new LightDict();
    }

    disable() {
        this._dict.destroy();
        delete this._dict;
    }
};

function init() {
    return new Extension();
}

