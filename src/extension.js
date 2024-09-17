// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import IBus from 'gi://IBus';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';
import {Spinner} from 'resource:///org/gnome/shell/ui/animation.js';

import * as Menu from './menu.js';
import * as Util from './util.js';
import * as Fubar from './fubar.js';
import {Field, Result} from './const.js';

const {_} = Fubar;
const DBusSSS = Main.shellDBusService._screenshotService._senderChecker;

const Trigger = {SWIFT: 0, POPUP: 1, DISABLE: 2};
const OCRMode = {WORD: 0, PARAGRAPH: 1, AREA: 2, LINE: 3, DIALOG: 4};
const Triggers = Util.omap(Trigger, ([k, v]) => [[v, k.toLowerCase()]]);
const OCRModes = Util.omap(OCRMode, ([k, v]) => [[v, k.toLowerCase()]]);
const Kaomojis = ['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']; // placeholder
const EvalMask = Object.getOwnPropertyNames(globalThis).filter(x => x !== 'eval').join(',');
const Modifier = {ctrl: Clutter.KEY_Control_L, shift: Clutter.KEY_Shift_L, alt: Clutter.KEY_Alt_L, super: Clutter.KEY_Super_L};
const LD_IFACE = `<node>
    <interface name="org.gnome.Shell.Extensions.LightDict">
        <method name="OCR">
            <arg type="s" direction="in" name="params"/>
        </method>
        <method name="Run">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
            <arg type="ai" direction="in" name="area"/>
        </method>
        <method name="Get">
            <arg type="as" direction="in" name="props"/>
            <arg type="aai" direction="out" name="results"/>
        </method>
    </interface>
</node>`; // NOTE: Maybe - https://gitlab.freedesktop.org/dbus/dbus/-/issues/25

const keyval = keysym => Modifier[keysym] ?? Clutter[`KEY_${keysym}`] ?? Clutter.KEY_VoidSymbol;
const approx = (exp, str, nil = true) => Fubar.essay(() => exp ? RegExp(exp, 'u').test(str) : nil, e => (logError(e, exp), nil)); // =~
const allowed = (cmd, app, str) => cmd ? (cmd.apps?.includes(app) ?? true) && approx(cmd.regexp, str) : false;
const evaluate = (script, scope) => Function(Object.keys(scope).concat(EvalMask).join(','),
    `'use strict'; return eval(${JSON.stringify(script)})`)(...Object.values(scope));

class GB {
    static get ptr() { return global.get_pointer(); };
    static get size() { return global.display.get_size(); }
    static get win() { return global.display.get_focus_window(); }
}

class DictPop extends Menu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(click) {
        super({styleClass: 'light-dict-button candidate-box'}, () => click(this.$index), null);
    }

    setup({icon, name, tooltip}, index, tip) {
        if(icon) {
            this.set_label('');
            this.set_icon_name(icon);
        } else {
            this.set_icon_name('');
            this.set_label(name || 'Name');
        }
        this.$index = index;
        this.setTip(tip ? tooltip : '');
    }
}

class DictBar extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass({
            Signals: {
                'dict-bar-clicked': {param_types: [GObject.TYPE_JSOBJECT]},
            },
        }, this);
    }

    constructor(set, delay) {
        super(St.Side.BOTTOM);
        this.#buildWidgets(delay);
        this.#bindSettings(set);
    }

    #buildWidgets(delay) {
        this.set({visible: false, styleClass: 'light-dict-bar-boxpointer'});
        this.$setHideDelay = Util.thunk(x => this.set({autoHide: x, quitHide: x / 10}), delay);
        this.$src = Fubar.Source.tie({hide: Fubar.Source.newTimer(x => [() => this.dispel(), x])}, this);
        this.box = Util.hook({
            'scroll-event': (...xs) => this.#onScroll(...xs),
            'notify::hover': ({hover}) => this.$src.hide.switch(!hover, this.quitHide),
        }, new St.BoxLayout({
            reactive: true, vertical: false, trackHover: true, styleClass: 'light-dict-iconbox candidate-popup-content',
        }));
        this.bin.set_child(this.box);
    }

    #bindSettings(set) {
        this.$set = set.attach({
            pageSize: [Field.PGSZ,  'uint'],
            tooltip:  [Field.TIP,   'boolean', x => this.#onTooltipSet(x)],
            cmds:     [Field.PCMDS, 'value',   x => this.#onCommandsSet(x)],
        }, this);
    }

    #onTooltipSet(tooltip) {
        if(Util.xnor(this.tooltip, tooltip)) return;
        let setup = tooltip ? (x, i) => x.setTip(this.cmds[i].tooltip) : x => x.setTip();
        [...this.box].forEach(setup);
    }

    #onCommandsSet(commands) {
        return Util.seq(cmds => Util.homolog(this.cmds, cmds, this.tooltip ? ['icon', 'name', 'tooltip'] : ['icon', 'name']) ||
                        Menu.upsert(this.box, x => x.add_child(new DictPop(y => { this.dispel(); this.emit('dict-bar-clicked', this.cmds[y]); })),
                            cmds, (v, x, i) => x.setup(v, i, this.tooltip), x => [...x]), commands.recursiveUnpack().filter(x => x.enable));
    }

    #getPages() {
        let length = this.cmds.reduce((p, x) => x.$visible ? p + 1 : p, 0);
        return length && this.pageSize ? Math.ceil(length / this.pageSize) : 0;
    }

    #updatePages(pages) {
        let icons = [...this.box].filter((x, i) => (x.visible = this.cmds[i].$visible));
        if(pages < 2) return;
        this.$index = this.$index < 1 ? pages : this.$index > pages ? 1 : this.$index ?? 1;
        if(this.$index === pages && icons.length % this.pageSize) {
            let start = icons.length - this.pageSize;
            icons.forEach((x, i) => Fubar.view(i >= start, x));
        } else {
            let end = this.$index * this.pageSize;
            let start = (this.$index - 1) * this.pageSize;
            icons.forEach((x, i) => Fubar.view(i >= start && i < end, x));
        }
    }

    #onScroll(_a, event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this.$index--; break;
        case Clutter.ScrollDirection.DOWN: this.$index++; break;
        default: return;
        }
        this.#updatePages(this.#getPages());
    }

    summon(app, str) {
        this.cmds.forEach(x => { x.$visible = allowed(x, app, str); });
        let pages = this.#getPages();
        if(pages < 1) return;
        if(Fubar.offstage(this)) Main.layoutManager.addTopChrome(this);
        this.#updatePages(pages);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this.autoHide);
    }

    dispel() {
        if(Fubar.offstage(this)) return;
        this.$src.hide.dispel();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this); // HACK: workaround for unexpected leave event on reappearing in entered prect
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(set, delay) {
        super(St.Side.TOP);
        this.#buildWidgets(delay);
        this.#bindSettings(set);
    }

    #buildWidgets(delay) {
        this.set({visible: false, styleClass: 'light-dict-box-boxpointer'});
        this.$setHideDelay = Util.thunk(x => this.set({autoHide: x, quitHide: x / 10}), delay);
        this.$src = Fubar.Source.tie({hide: Fubar.Source.newTimer(x => [() => this.dispel(), x])}, this);
        this.view = Util.hook({
            'button-press-event': (...xs) => this.#onClick(...xs),
            'notify::hover': ({hover}) => this.$src.hide.switch(!hover, this.quitHide),
        }, new St.ScrollView({
            child: new St.BoxLayout({vertical: true, styleClass: 'light-dict-content'}),
            styleClass: 'light-dict-view', overlayScrollbars: true, reactive: true, trackHover: true,
        }));
        this.$info = this.#insertLabel('light-dict-info');
        this.bin.set_child(this.view);
    }

    #bindSettings(set) {
        this.$set = set.attach({
            leftCmd:  [Field.LCMD, 'string'],
            rightCmd: [Field.RCMD, 'string'],
            title:    [Field.TITL, 'boolean', x => { if(!Util.xnor(x, this.$text)) x ? this.$text = this.#insertLabel() : Fubar.omit(this, '$text'); }],
        }, this);
    }

    #insertLabel(styleClass = 'light-dict-text', index = 0) {
        let label = new St.Label({styleClass});
        label.clutterText.set({lineWrap: true, ellipsize: Pango.EllipsizeMode.NONE, lineWrapMode: Pango.WrapMode.WORD_CHAR});
        this.view.child.insert_child_at_index(label, index);
        return label;
    }

    #updateScroll() {
        let [,, w, h] = this.get_preferred_size(),
            theme = this.view.get_theme_node(),
            limit = theme.get_max_height();
        if(limit <= 0) limit = GB.size.at(1) * 15 / 32;
        let scroll = h >= limit;
        let count = scroll ? w * limit / (Clutter.Settings.get_default().fontDpi / 1024 * theme.get_font().get_size() / 1024 / 72) ** 2
            : [...this.$info.get_text()].reduce((p, x) => p + (GLib.unichar_iswide(x) ? 2 : GLib.unichar_iszerowidth(x) ? 0 : 1), 0);
        this.$delay = Math.clamp(this.autoHide * count / 36, 1000, 20000);
        this.view.vscrollbarPolicy = scroll ? St.PolicyType.ALWAYS : St.PolicyType.NEVER; // HACK: workaround for trailing lines with default policy (AUTOMATIC)
        this.view.vadjustment.set_value(0);
    }

    #onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: Fubar.copy(this.$info.get_text().substring(1)); break; // HACK: remove workaround ZWSP
        case Clutter.BUTTON_PRIMARY: if(this.leftCmd) Util.execute(this.leftCmd, {LDWORD: this.$txt}).catch(Util.noop); break;
        case Clutter.BUTTON_SECONDARY: if(this.rightCmd) Util.execute(this.rightCmd, {LDWORD: this.$txt}).catch(Util.noop); this.dispel(); break;
        }
    }

    #setState(error, info) {
        let state = error ? 'state-error' : info ? '' : 'state-empty';
        if(this.$state === state) return;
        if(this.$state) this.view.remove_style_pseudo_class(this.$state);
        if((this.$state = state)) this.view.add_style_pseudo_class(this.$state);
    }

    summon(info, text, error) {
        this.$txt = text;
        this.#setState(error, info);
        if(Fubar.offstage(this)) Main.layoutManager.addTopChrome(this);
        info ||= Util.lot(Kaomojis);
        try {
            Pango.parse_markup(info, -1, '');
            Fubar.markup(this.$info, info);
        } catch(e) {
            this.$info.set_text(info);
        }
        this.$text?.set_text(text);
        this.#updateScroll();
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this.autoHide);
    }

    dispel() {
        if(Fubar.offstage(this)) return;
        this.$src.hide.dispel();
        this.prect = this.get_transformed_extents();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this);
    }
}

class DictAct extends Fubar.Mortal {
    constructor(set) {
        super();
        this.#buildWidgets();
        this.#bindSettings(set);
        this.#buildSources();
    }

    #buildWidgets() {
        this.$tty = new Gio.SubprocessLauncher({flags: Util.PIPE});
    }

    #bindSettings(set) {
        this.$set = set.attach({
            enableOcr: [Field.OCR, 'boolean', x => this.#onEnableOcrSet(x), x => this.#onEnableOcrPut(x)],
        }, this).attach({
            trigger: [Field.TRG, 'uint', null, x => this.tray?.$menu.trigger.choose(x)],
            passive: [Field.PSV, 'uint', x => !!x, x => this.tray?.$menu.passive.setToggleState(x)],
        }, this, () => this.#onTrayIconSet(), () => this.tray?.$icon.setup(this.icon)).attach({
            cmds: [Field.SCMDS, 'value',   x => this.#onCommandsSet(x)],
            dish: [Field.STRY,  'boolean', null, x => this.$src.tray.toggle(x)],
            cmd:  [Field.SCMD,  'int',     null, x => this.tray?.$menu.cmds.choose(x)],
        }, this);
    }

    #buildSources() {
        let cancel = Fubar.Source.newCancel(),
            ocr = Fubar.Source.new(() => this.#genOCR(), this.enableOcr),
            tray = Fubar.Source.new(() => this.#genSystray(ocr.hub), this.dish),
            stroke = new Fubar.Source(x => x.split(/\s+/).map((y, i) => setTimeout(() => this.#stroke(y.split('+')), i * 50)),
                x => x?.splice(0).forEach(clearTimeout)),
            kbd = new Fubar.Source(() => Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
                x => x?.run_dispose(), true); // run_dispose to release keys immediately
        this.$src = Fubar.Source.tie({cancel, ocr, tray, stroke, kbd}, this);
    }

    get ocr() {
        return this.$src.ocr.hub;
    }

    get tray() {
        return this.$src.tray.hub;
    }

    #stroke(keys) {
        let kbd = this.$src.kbd.hub;
        keys.forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.PRESSED));
        keys.reverse().forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.RELEASED));
    }

    #genOCR() {
        let ocr = new Fubar.Mortal();
        this.$set.attach({
            param: [Field.OCRP, 'string'],
            mode:  [Field.OCRS, 'uint', null, x => this.tray?.$menu.ocrMode.choose(x)],
        }, ocr, () => { ocr.cmd = `python ${Util.ROOT}/ldocr.py -m ${OCRModes[ocr.mode]} ${ocr.param}`; }).attach({
            keys:  [Field.KEY,  'boolean', null, x => ocr.$src.keys.toggle(x)],
            dwell: [Field.DOCR, 'boolean', null, x => { ocr.$src.dwell.toggle(x); this.tray?.$setDwell(x); }],
        }, ocr);
        ocr.$genDwellItem = () => new Menu.SwitchItem(_('Dwell OCR'), ocr.dwell, x => this.$set.set('dwell', x, ocr));
        ocr.$genModeItem = () => new Menu.RadioItem(_('OCR'), Menu.RadioItem.getopt(OCRMode), ocr.mode, x => this.$set.set('mode', x, ocr));
        let keys = Fubar.Source.newKeys(this.$set.hub, Field.KEYS, () => this.OCR(), ocr.keys),
            emit = Fubar.Source.newTimer(x => Util.seq(() => { ocr.ppos = ocr.pos; ocr.pos = x; },
                [() => this.emit('dict-act-dwelled', GB.ptr[2], ocr.ppos), 180])), // 180 = 170 + 10
            dwell = new Fubar.Source(() => PointerWatcher.getPointerWatcher().addWatch(170, (...xs) => emit.revive(xs)), x => x?.remove(), ocr.dwell),
            invoke = new Fubar.Source(x => Util.seq(() => {
                DBusSSS._isSenderAllowed = async s => ocr.$pid === (await Gio.DBus.session.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
                    'GetConnectionUnixProcessID', Util.pickle([s]), null, Gio.DBusCallFlags.NONE, -1, null)).deepUnpack()[0];
                this.execute(x ? `${ocr.cmd} ${x}` : ocr.cmd).catch(Util.noop).finally(() => { delete ocr.$pid; ocr.$src.invoke.dispel(); });
            }, DBusSSS._isSenderAllowed), x => { if(x) DBusSSS._isSenderAllowed = x; });
        ocr.$src = Fubar.Source.tie({invoke, dwell, emit, keys}, ocr);
        return ocr;
    }

    #genSystray(ocr) {
        let tray = new Menu.Systray({
            dwell:   ocr?.$genDwellItem(),
            passive: new Menu.SwitchItem(_('Passive mode'), this.passive, x => this.$set.set('passive', x ? 1 : 0, this)),
            sep0:    new PopupMenu.PopupSeparatorMenuItem(),
            trigger: new Menu.RadioItem(_('Trigger'), Menu.RadioItem.getopt(Trigger), this.trigger, x => this.$set.set('trigger', x, this)),
            cmds:    new Menu.RadioItem(_('Swift'), this.cmds.map(x => x.name), this.cmd, x => this.$set.set('cmd', x, this)),
            ocrMode: ocr?.$genModeItem(),
            sep1:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new Menu.Item(_('Settings'), () => Fubar.me().openPreferences()),
        }, this.icon);
        tray.add_style_class_name('light-dict-systray');
        tray.$setDwell = Util.thunk(x => {
            x ? tray.add_style_pseudo_class('state-busy') : tray.remove_style_pseudo_class('state-busy');
            tray.$menu.dwell?.setToggleState(x);
        }, ocr?.dwell);
        tray.connect('scroll-event', (_a, event) => {
            switch(event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP: this.$set.set('trigger', (this.trigger + 1) % 2, this); break;
            case Clutter.ScrollDirection.DOWN: this.$set.set('passive', this.passive ? 0 : 1, this); break;
            }
        });
        return tray;
    }

    #onTrayIconSet() {
        this.icon = `ld-${Triggers[this.trigger]}-${this.passive ? 'passive' : 'proactive'}-symbolic`;
    }

    #onEnableOcrSet(enable) {
        let spawnv = Gio.SubprocessLauncher.prototype.spawnv.bind(this.$tty);
        this.$tty.spawnv = enable ? x => Util.seq(p => { this.ocr.$pid = parseInt(p.get_identifier()); }, spawnv(x)) : spawnv;
    }

    #onEnableOcrPut(enable) {
        this.$src.ocr.toggle(enable);
        Menu.record(enable, this.tray, () => this.ocr.$genDwellItem(), 'dwell', 'passive', () => this.ocr.$genModeItem(), 'ocrMode', 'sep1');
    }

    #onCommandsSet(commands) {
        return Util.seq(x => Util.homolog(this.cmds, x, ['name']) || this.$src?.tray.hub?.$menu
                   .cmds.setOptions(x.map(c => c.name)), commands.recursiveUnpack());
    }

    getCommand(name) {
        return (name ? this.cmds.find(x => x.name === name) : this.cmds[this.cmd]) ?? this.cmds[0];
    }

    OCR(override) {
        this.ocr?.$src.invoke.toggle(true, override);
    }

    stroke(keys) {
        this.$src.stroke.revive(keys);
    }

    commit(string) {
        let InputSourceManager = Keyboard.getInputSourceManager();
        if(InputSourceManager.currentSource.type !== Keyboard.INPUT_SOURCE_TYPE_IBUS) Main.inputMethod.commit(string); // TODO: not tested
        else InputSourceManager._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
    }

    execute(cmd, env) {
        return Util.execute(cmd, env, this.$src.cancel.reborn(), this.$tty);
    }
}

class LightDict extends Fubar.Mortal {
    constructor(gset) {
        super();
        this.#bindSettings(gset);
        this.#buildSources();
        this.#buildWidgets();
    }

    #bindSettings(gset) {
        this.$set = new Fubar.Setting(gset, {
            filter:   [Field.TFLT, 'string'],
            appList:  [Field.APPS, 'string'],
            listType: [Field.APP,  'uint'],
            splicing: [Field.SPLC, 'boolean'],
            autoHide: [Field.ATHD, 'uint', null, x => ['box', 'bar'].forEach(y => this.$src[y].setHideDelay(x))],
        }, this);
    }

    #buildSources() {
        let box =  new DictBox(this.$set, this.autoHide),
            csr =  new Clutter.Actor({opacity: 0, x: 1, y: 1}), // HACK: init pos to avoid misplacing at the first occurrence
            act =  Util.hook({'dict-act-dwelled': (...xs) => this.#onDwell(...xs)}, new DictAct(this.$set)),
            bar =  Util.hook({'dict-bar-clicked': (_a, x) => { this.$lck.dwell[0] = true; this.runCmd(x); }}, new DictBar(this.$set, this.autoHide)),
            dbus = Fubar.Source.newDBus(LD_IFACE, '/org/gnome/Shell/Extensions/LightDict', this, true),
            hold = Fubar.Source.newTimer(x => [() => this.#onButtonHold(x), 50], false), // debounce for GTK+
            wait = new Fubar.Source(() => this.#genSpinner());
        this.$src = Fubar.Source.tie({box, csr, act, bar, dbus, hold, wait}, this);
    }

    #buildWidgets() {
        this.$lck = {dwell: [], select: []};
        Fubar.connect(this, global.display.get_selection(), 'owner-changed', (...xs) => this.#onSelect(...xs),
            global.display, 'notify::focus-window', () => { this.dispelAll(); this.#syncApp(); });
        Main.uiGroup.add_child(this.$src.csr);
        this.#syncApp();
    }

    #genSpinner() {
        let spin = new Spinner(16);
        spin.add_style_class_name('light-dict-view');
        Main.layoutManager.addTopChrome(spin);
        let [x, y] = GB.ptr;
        let s = Meta.prefs_get_cursor_size() >>> 1;
        spin.set_position(x + s, y + s);
        spin.play();
        return spin;
    }

    #onSelect(_s, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        this.$src.hold.dispel();
        let mods = GB.ptr.at(2);
        if(this.$lck.select.pop() || this.#denyApp() || this.#denyMods(mods) || this.$src.act.trigger === Trigger.DISABLE) return;
        if(mods & Clutter.ModifierType.BUTTON1_MASK) this.$src.hold.summon(mods);
        else this.run().catch(Util.noop);
    }

    #onButtonHold(mods) {
        if((mods ^ GB.ptr.at(2)) !== Clutter.ModifierType.BUTTON1_MASK) return;
        this.$src.hold.dispel();
        this.run().catch(Util.noop);
    }

    #setCursor(area) {
        this.dispelAll();
        let [x, y, w, h] = area && area[3] < GB.size.at(1) / 2 ? area
            : (s => (([a, b], c, d) => [a - c, b - c, d, d])(GB.ptr, s / 2, s * 1.15))(Meta.prefs_get_cursor_size());
        this.center = area && w > 250;
        this.$src.csr.set_position(x, y);
        this.$src.csr.set_size(w, h);
    }

    #syncApp() {
        this.app = (w => w ? Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '' : '')(GB.win);
    }

    #denyApp() {
        return this.appList && Util.xnor(this.listType, this.appList.includes(this.app));
    }

    #denyMods(mods) {
        return this.$src.act.passive && !(mods & Clutter.ModifierType.MOD1_MASK);
    }

    #onDwell(_a, mods, [x, y]) {
        let {box, bar, act} = this.$src;
        if(this.$lck.dwell.pop() || box.prect?.contains_point(new Graphene.Point().init(x, y)) || act.ocrMode === OCRMode.AREA ||
           box.visible && box.view.hover || bar.visible && bar.box.hover || this.#denyMods(mods)) return;
        act.OCR('--quiet');
    }

    #postRun(output, result) {
        if(result & Result.SHOW) this.display(output);
        if(result & Result.COPY) Fubar.copy(output);
        if(result & Result.SELECT) Fubar.copy(output, true);
        if(result & Result.COMMIT) this.$src.act.commit(output);
    }

    async #runSh({command, result}) {
        let env = {LDWORD: this.txt, LDAPPID: this.app};
        if(result) {
            try {
                if(result & Result.AWAIT) {
                    this.$src.wait.toggle(true);
                    let stdout = await this.$src.act.execute(command, env);
                    this.$src.wait.toggle(false);
                    this.#postRun(stdout, result);
                } else {
                    this.#postRun(await this.$src.act.execute(command, env), result);
                }
            } catch(e) {
                this.$src.wait.toggle(false);
                if(!Fubar.Source.cancelled(e)) this.display(e.message, true);
            }
        } else {
            Util.execute(command, env).catch(logError);
        }
    }

    #runJS({command, result}) {
        try {
            let {open, copy} = Fubar;
            let output = evaluate(command, {
                open, copy,
                LDWORD: this.txt,
                LDAPPID: this.app,
                key: x => this.$src.act.stroke(x),
                search: x => { Main.overview.show(); Main.overview.searchEntry.set_text(x); },
            });
            if(result) this.#postRun(String(output), result);
        } catch(e) {
            this.display(e.message, true);
        }
    }

    dispelAll() {
        this.$src.box.dispel();
        this.$src.bar.dispel();
    }

    async runCmd(cmd) {
        cmd.type ? this.#runJS(cmd) : await this.#runSh(cmd);
    }

    select(text) {
        this.$lck.select[0] = true;
        Fubar.copy(text, true);
    }

    async swift(name) {
        let cmd = this.$src.act.getCommand(name);
        if(allowed(cmd, this.app, this.txt)) await this.runCmd(cmd);
    }

    popup() {
        this.$src.bar.setPosition(this.$src.csr, 1 / 2);
        this.$src.bar.summon(this.app, this.txt);
    }

    display(info, error) {
        this.$src.box.setPosition(this.$src.csr, this.center ? 1 / 2 : 1 / 10);
        this.$src.box.summon(info, this.txt, error);
    }

    store(text) {
        if(this.splicing) text = text?.replace(/(?<![\p{Sentence_Terminal}\n])\n+/gu, ' ');
        if(!text) throw Error('empty');
        this.txt = text;
    }

    async run() {
        let text = await Fubar.paste(true);
        if(this.$src.act.passive || !approx(this.filter, text, false)) this.#run('auto', text);
    }

    async #run(type, text, info, area) {
        this.#setCursor(area);
        let [kind, name] = type === 'auto' ? [Triggers[this.$src.act.trigger]] : type.split(':');
        this.store(text || (kind === 'display' ? 'Oops' : await Fubar.paste(true)));
        switch(kind) {
        case 'swift':   await this.swift(name); break;
        case 'popup':   this.popup(); break;
        case 'display': this.display(info, !text); break;
        }
    }

    async RunAsync([type, text, info, area], invocation) {
        await this.#run(type, text, info, area.length === 4 ? area : null).catch(Util.noop);
        invocation.return_value(null);
    }

    async GetAsync([props], invocation) {
        try {
            await DBusSSS.checkInvocation(invocation);
            invocation.return_value(new GLib.Variant('(aai)', [props.map(x => {
                switch(x) {
                case 'display': return GB.size;
                case 'pointer': return GB.ptr.slice(0, 2);
                case 'focused': return (r => r ? [r.x, r.y, r.width, r.height] : null)(GB.win?.get_frame_rect?.());
                default: throw Error(`Unknown property: ${x}`);
                }
            })]));
        } catch(e) {
            if(e instanceof GLib.Error) invocation.return_gerror(e);
            else invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message);
        }
    }

    OCR(args) {
        this.dispelAll();
        this.$src.act.OCR(args);
    }
}

export default class Extension extends Fubar.Extension { $klass = LightDict; }
