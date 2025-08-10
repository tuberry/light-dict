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
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

import * as T from './util.js';
import * as M from './menu.js';
import * as F from './fubar.js';
import {Key as K, Result} from './const.js';

const {_} = F;
const {$, $$, $_} = T;
const DBusSSS = Main.shellDBusService._screenshotService._senderChecker;

const Trigger = {SWIFT: 0, POPUP: 1, DISABLE: 2};
const OCRMode = {WORD: 0, PARAGRAPH: 1, AREA: 2, LINE: 3, DIALOG: 4};
const Triggers = T.omap(Trigger, ([k, v]) => [[v, k.toLowerCase()]]);
const OCRModes = T.omap(OCRMode, ([k, v]) => [[v, k.toLowerCase()]]);
const Kaomojis = ['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']; // placeholder
const EvalMask = Object.getOwnPropertyNames(globalThis).filter(x => x !== 'eval').join(',');
const Modifier = {ctrl: Clutter.KEY_Control_L, shift: Clutter.KEY_Shift_L, alt: Clutter.KEY_Alt_L, super: Clutter.KEY_Super_L};

const keyval = keysym => Modifier[keysym] ?? Clutter[`KEY_${keysym}`] ?? Clutter.KEY_VoidSymbol;
const approx = (exp, str, nil = true) => T.essay(() => exp ? RegExp(exp, 'u').test(str) : nil, e => (logError(e, exp), nil)); // =~
const allowed = (cmd, app, str) => cmd ? (!cmd.apps?.length || cmd.apps.includes(app)) && approx(cmd.regexp, str) : false;
const evaluate = (script, scope) => Function(Object.keys(scope)[$].push(EvalMask).join(','),
    `'use strict'; return eval(${JSON.stringify(script)})`)(...Object.values(scope)); // NOTE: https://github.com/tc39/proposal-shadowrealm

class GB {
    static get pointer() { return global.get_pointer(); };
    static get display() { return global.display.get_size(); }
    static get window() { return global.display.get_focus_window(); }
    static get cursor() { return Meta.prefs_get_cursor_size(); }
}

class DictBtn extends M.Button {
    static {
        T.enrol(this);
    }

    constructor(click) {
        super(() => click(this.$index), null)[$].set({styleClass: 'light-dict-button candidate-box'});
    }

    setup({icon, name, tooltip}, index, tip) {
        if(icon) this[$].set_label('').set_icon_name(icon);
        else this[$].set_icon_name('').set_label(name || 'Name');
        this[$].$index(index).setTip(tip ? tooltip : '');
    }
}

class DictBar extends BoxPointer.BoxPointer {
    static {
        T.enrol(this, null, {Signals: {'dict-bar-clicked': {param_types: [GObject.TYPE_JSOBJECT]}}});
    }

    constructor(set) {
        super(St.Side.BOTTOM)[$].set({visible: false, styleClass: 'light-dict-bar-boxpointer'})[$]
            .$buildWidgets()[$].$bindSettings(set);
    }

    $buildWidgets() {
        this.$src = F.Source.tie({hide: F.Source.newTimer(x => [() => this.dispel(), x])}, this);
        this.$box = T.seq(new St.BoxLayout({
            reactive: true, trackHover: true, styleClass: 'light-dict-iconbox candidate-popup-content',
        })[$$].connect([
            ['scroll-event', (...xs) => this.#onScroll(...xs)],
            ['notify::hover', ({hover}) => this.$src.hide.switch(!hover, this[K.TIME] / 10)],
        ]), w => this.bin.set_child(w));
    }

    $bindSettings(set) {
        this.$set = set.tie([
            K.TIME, K.PGSZ, [K.TIP, x => this.#onTooltipSet(x)],
            [['cmds', K.PCMDS], x => this.#onCommandsSet(x)],
        ], this);
    }

    #onTooltipSet(tip) {
        if(T.xnor(this[K.TIP], tip)) return;
        let setup = tip ? (x, i) => x.setTip(this.cmds[i].tooltip) : x => x.setTip();
        Iterator.from(this.$box).forEach(setup);
    }

    #onCommandsSet(commands) {
        return T.seq(commands.filter(x => x.enable), cmds => T.homolog(this.cmds, cmds, ['icon', 'name'][$_].push(this[K.TIP], 'tooltip')) ||
            M.upsert(this.$box, x => x.add_child(new DictBtn(y => this[$].dispel().emit('dict-bar-clicked', this.cmds[y]))),
                cmds, (v, x, i) => x.setup(v, i, this[K.TIP]), Iterator.from));
    }

    #getPages() {
        let length = this.cmds.reduce((p, x) => x.$visible ? p + 1 : p, 0);
        return length && this[K.PGSZ] ? Math.ceil(length / this[K.PGSZ]) : 0;
    }

    #updatePages(pages) {
        let icons = [...this.$box].filter((x, i) => (x.visible = this.cmds[i].$visible));
        if(pages < 2) return;
        this.$index = this.$index < 1 ? pages : this.$index > pages ? 1 : this.$index ?? 1;
        if(this.$index === pages && icons.length % this[K.PGSZ]) {
            let start = icons.length - this[K.PGSZ];
            icons.forEach((x, i) => F.view(i >= start, x));
        } else {
            let end = this.$index * this[K.PGSZ];
            let start = (this.$index - 1) * this[K.PGSZ];
            icons.forEach((x, i) => F.view(i >= start && i < end, x));
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
        if(F.offstage(this)) Main.layoutManager.addTopChrome(this);
        this.#updatePages(pages);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this[K.TIME]);
    }

    dispel() {
        if(F.offstage(this)) return;
        this.$src.hide.dispel();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this); // HACK: workaround for unexpected leave event on reappearing in entered prect
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        T.enrol(this);
    }

    constructor(set) {
        super(St.Side.TOP, {styleClass: 'light-dict-view-bin'})[$].set({visible: false, styleClass: 'light-dict-box-boxpointer'})[$]
            .$buildWidgets()[$].$bindSettings(set);
    }

    $buildWidgets() {
        this.$src = F.Source.tie({hide: F.Source.newTimer(x => [() => this.dispel(), x])}, this);
        this.$view = T.seq(new St.ScrollView({
            child: new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, styleClass: 'light-dict-content'}),
            styleClass: 'light-dict-view', overlayScrollbars: true, reactive: true, trackHover: true,
        })[$$].connect([
            ['button-press-event', (...xs) => this.#onClick(...xs)],
            ['notify::hover', ({hover}) => this.$src.hide.switch(!hover, this[K.TIME] / 10)],
        ]), w => this.bin.set_child(w));
        this.$info = this.#insertLabel('light-dict-info');
    }

    $bindSettings(set) {
        this.$set = set.tie([
            K.LCMD, K.RCMD, K.TIME,
            [K.HEAD, x => { if(!T.xnor(x, this.$text)) x ? this.$text = this.#insertLabel() : F.omit(this, '$text'); }],
        ], this);
    }

    #insertLabel(styleClass = 'light-dict-text', index = 0) {
        let ret = new St.Label({styleClass});
        ret.clutterText.set({lineWrap: true, ellipsize: Pango.EllipsizeMode.NONE, lineWrapMode: Pango.WrapMode.WORD_CHAR});
        this.$view.child.insert_child_at_index(ret, index);
        return ret;
    }

    #updateScroll() {
        let [, , w, h] = this.get_preferred_size(),
            theme = this.$view.get_theme_node(),
            limit = theme.get_max_height();
        if(limit <= 0) limit = GB.display.at(1) * 15 / 32;
        let scroll = h >= limit;
        let count = scroll ? w * limit / (Clutter.Settings.get_default().fontDpi / 1024 * theme.get_font().get_size() / 1024 / 72) ** 2
            : Iterator.from(this.$info.get_text()).reduce((p, x) => p + (GLib.unichar_iswide(x) ? 2 : GLib.unichar_iszerowidth(x) ? 0 : 1), 0);
        this.$view[$].vscrollbarPolicy(scroll ? St.PolicyType.ALWAYS : St.PolicyType.NEVER).vadjustment.set_value(0); // HACK: workaround for trailing lines with default policy (AUTOMATIC)
        this.$delay = Math.clamp(this[K.TIME] * count / 36, 1000, 20000);
    }

    #onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: F.copy(this.$info.get_text().slice(1)); break; // HACK: remove workaround ZWSP
        case Clutter.BUTTON_PRIMARY: if(this[K.LCMD]) T.execute(this[K.LCMD], {LDWORD: this.$txt}).catch(T.nop); break;
        case Clutter.BUTTON_SECONDARY: if(this[K.RCMD]) T.execute(this[K.RCMD], {LDWORD: this.$txt}).catch(T.nop); this.dispel(); break;
        }
    }

    #setState(error, info) {
        let state = error ? 'state-error' : info ? '' : 'state-empty';
        if(this.$state === state) return;
        this.$view[$_].remove_style_pseudo_class(this.$state, this.$state)[$_]
            .add_style_pseudo_class(this.$state = state, this.$state);
    }

    summon(info, text, error) {
        this.$txt = text;
        this.#setState(error, info);
        if(F.offstage(this)) Main.layoutManager.addTopChrome(this);
        info ||= T.lot(Kaomojis);
        try {
            Pango.parse_markup(info, -1, '');
            F.marks(this.$info, info);
        } catch{
            this.$info.set_text(info);
        }
        this.$text?.set_text(text);
        this.#updateScroll();
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this.$delay);
    }

    dispel() {
        if(F.offstage(this)) return;
        this.$src.hide.dispel();
        this.prect = this.get_transformed_extents();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this);
    }
}

class DictAct extends F.Mortal {
    constructor(set) {
        super()[$].$bindSettings(set)[$].$buildSources();
    }

    $bindSettings(set) {
        this.$set = set.tie([
            [K.TRG, null, x => this.$src.tray.hub?.$menu.trigger.choose(x)],
            [K.PSV, x => !!x, x => this.$src.tray.hub?.$menu.passive.setToggleState(x)],
        ], this, () => this.#onTrayIconSet(), () => this.$src.tray.hub?.$icon.set_icon_name(this.icon)).tie([
            [['cmds', K.SCMDS], x => this.#onCommandsSet(x)],
            [K.TRAY, null, x => this.$src.tray.toggle(x)],
            [K.OCR, null, x => this.#onEnableOcrSet(x)],
            [K.SCMD, null, x => this.$src.tray.hub?.$menu.cmds.choose(x)],
        ], this);
    }

    $buildSources() {
        let cancel = F.Source.newCancel(),
            tty = new F.Source(() => new Gio.SubprocessLauncher({flags: T.PIPE}), x => x.close(), true),
            ocr = F.Source.new(() => this.#genOCR(tty.hub), this[K.OCR]),
            tray = F.Source.new(() => this.#genSystray(ocr.hub), this[K.TRAY]),
            kbd = new F.Source(() => Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
                x => x.run_dispose(), true), // run_dispose to release keys immediately
            stroke = new F.Source(x => x.split(/\s+/).map((y, i) => setTimeout(() => this.#stroke(y.split('+'), kbd.hub), i * 50)),
                x => x.splice(0).forEach(y => clearTimeout(y)));
        this.$src = F.Source.tie({cancel, ocr, tray, tty, stroke, kbd}, this);
    }

    #stroke(keys, kbd) {
        keys.forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.PRESSED));
        keys.reverse().forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.RELEASED));
    }

    #genOCR(tty) {
        let ret = new F.Mortal();
        this.$set.tie([
            K.OCRP, [K.OCRS, null, x => this.$src.tray.hub?.$menu.ocr.choose(x)],
        ], ret, () => { ret.cmd = `python ${T.ROOT}/ldocr.py -m ${OCRModes[ret[K.OCRS]]} ${ret[K.OCRP]}`; }).tie([
            [K.KEYS, x => !!x.length, x => ret.$src.keys.toggle(x)],
            [K.DOCR, null, x => { ret.$src.dwell.toggle(x); this.$src.tray.hub?.$setDwell(x); }],
        ], ret);
        ret.$genDwellItem = () => new M.SwitchItem(_('Dwell OCR'), ret[K.DOCR], x => this.$set.set(K.DOCR, x));
        ret.$genModeItem = () => new M.RadioItem(_('OCR'), M.RadioItem.getopt(OCRMode), ret[K.OCRS], x => this.$set.set(K.OCRS, x));
        let emit = F.Source.newTimer(x => T.seq([() => this.emit('dict-act-dwelled', GB.pointer[2], ret.ppt), 180], () => { ret.ppt = ret.pt; ret.pt = x; })), // 180 = 170 + 10
            dwell = new F.Source(() => PointerWatcher.getPointerWatcher().addWatch(170, (...xs) => emit.revive(xs)), x => x.remove(), ret[K.DOCR]),
            spawn = F.Source.newInvoker(() => F.Source.newInjector([tty, {spawnv: (a, f, xs) => T.seq(f.apply(a, xs), p => { ret.pid = parseInt(p.get_identifier()); })},
                DBusSSS, [['_isSenderAllowed', async (_a, _f, xs) => ret.pid === (await Gio.DBus.session.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
                    'GetConnectionUnixProcessID', T.pickle(xs), null, Gio.DBusCallFlags.NONE, -1, null)).recursiveUnpack()[0]]]], true), x =>
                this.execute(x ? `${ret.cmd} ${x}` : ret.cmd).catch(T.nop).finally(() => delete ret.pid)),
            keys = F.Source.newKeys(this.$set.hub, K.KEYS, () => spawn.invoke(), ret[K.KEYS]);
        ret.$src = F.Source.tie({spawn, dwell, emit, keys}, ret);
        return ret;
    }

    #genSystray(ocr) {
        return new M.Systray({
            dwell:   ocr?.$genDwellItem(),
            passive: new M.SwitchItem(_('Passive mode'), this[K.PSV], x => this.$set.set(K.PSV, x ? 1 : 0)),
            sep0:    new M.Separator(),
            trigger: new M.RadioItem(_('Trigger'), M.RadioItem.getopt(Trigger), this[K.TRG], x => this.$set.set(K.TRG, x)),
            cmds:    new M.RadioItem(_('Swift'), this.cmds.map(x => x.name), this[K.SCMD], x => this.$set.set(K.SCMD, x)),
            ocr:     ocr?.$genModeItem(),
            sep1:    new M.Separator(),
            prefs:   new M.Item(_('Settings'), () => F.me().openPreferences()),
        }, this.icon)[$]
        .add_style_class_name('light-dict-systray')[$_]
        .add_style_pseudo_class(ocr?.[K.DOCR], 'state-busy')[$]
        .$setDwell(function (dwell) {
            dwell ? this.add_style_pseudo_class('state-busy') : this.remove_style_pseudo_class('state-busy');
            this.$menu.dwell.setToggleState(dwell);
        })[$].connect('scroll-event', (_a, event) => {
            switch(event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP: this.$set.set(K.TRG, (this[K.TRG] + 1) % 2); break;
            case Clutter.ScrollDirection.DOWN: this.$set.set(K.PSV, this[K.PSV] ? 0 : 1); break;
            }
        });
    }

    #onTrayIconSet() {
        this.icon = `ld-${Triggers[this[K.TRG]]}-${this[K.PSV] ? 'passive' : 'proactive'}-symbolic`;
    }

    #onEnableOcrSet(enable) {
        this.$src.ocr.toggle(enable);
        M.record(enable, this.$src.tray.hub, () => this.$src.ocr.hub.$genDwellItem(), 'dwell', 'passive', () => this.$src.ocr.hub.$genModeItem(), 'ocr', 'sep1');
    }

    #onCommandsSet(commands) {
        return T.seq(commands, cmds => T.homolog(this.cmds, cmds, ['name']) || this.$src?.tray.hub?.$menu.cmds.setup(cmds.map(x => x.name)));
    }

    getCommand(name) {
        return (name ? this.cmds.find(x => x.name === name) : this.cmds[this[K.SCMD]]) ?? this.cmds[0];
    }

    OCR(args) {
        this.$src.ocr.hub?.$src.spawn.invoke(args);
    }

    stroke(keys) {
        this.$src.stroke.revive(keys);
    }

    commit(string) {
        let ism = Keyboard.getInputSourceManager();
        if(ism.currentSource.type !== Keyboard.INPUT_SOURCE_TYPE_IBUS) Main.inputMethod.commit(string); // TODO: not tested
        else ism._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
    }

    execute(cmd, env) {
        return T.execute(cmd, env, this.$src.cancel.reborn(), this.$src.tty.hub);
    }
}

class LightDict extends F.Mortal {
    constructor(gset) {
        super()[$].$bindSettings(gset)[$].$buildSources()[$].$buildWidgets();
    }

    $bindSettings(gset) {
        this.$set = new F.Setting(gset, [K.TFLT, K.APPS, K.APP, K.SPLC], this);
    }

    $buildSources() {
        let box = new DictBox(this.$set),
            csr = T.seq(new Clutter.Actor({opacity: 0, x: 1, y: 1}), x => Main.uiGroup.add_child(x)), // HACK: init pos to avoid misplacing at the first occurrence
            act = new DictAct(this.$set)[$].connect('dict-act-dwelled', (...xs) => this.#onDwell(...xs)),
            bar = new DictBar(this.$set)[$].connect('dict-bar-clicked', (_a, x) => { this.$lck.dwell[0] = true; this.runCmd(x); }),
            dbus = F.Source.newDBus('org.gnome.Shell.Extensions.LightDict', '/org/gnome/Shell/Extensions/LightDict', this, true),
            poll = F.Source.newDefer(() => this.#postPoll(), () => !(GB.pointer.at(2) & Clutter.ModifierType.BUTTON1_MASK), 50), // debounce for GTK+
            wait = F.Source.newInvoker(() => F.Source.new(() => this.#genSpinner(), true), (...xs) => act.execute(...xs));
        this.$src = F.Source.tie({box, csr, act, bar, dbus, poll, wait}, this);
    }

    $buildWidgets() {
        this.$lck = {dwell: []};
        F.connect(this, global.display.get_selection(), 'owner-changed', (...xs) => this.#onSelect(...xs),
            global.display, 'notify::focus-window', (() => { this.dispelAll(); this.#syncApp(); })[$].call());
    }

    #genSpinner() {
        let [x, y] = GB.pointer;
        let size = GB.cursor >>> 1;
        return T.seq(new St.Bin({styleClass: 'light-dict-spinner', child: new Animation.Spinner(18)[$].play()})[$]
            .set_position(x + size, y + size), w => Main.layoutManager.addTopChrome(w));
    }

    #onSelect(_s, type, src) {
        if(type !== St.ClipboardType.PRIMARY || !src || src instanceof Meta.SelectionSourceMemory ||
            this.#denyApp() || this.#denyMdf() || this.$src.act[K.TRG] === Trigger.DISABLE) return;
        this.$src.poll.revive();
    }

    #postPoll() {
        F.paste(true).then(x => (this.$src.act[K.PSV] || !approx(this[K.TFLT], x, false)) && this.run('auto', x)).catch(T.nop);
    }

    #setSourceArea(area) {
        this.dispelAll();
        let [x, y, w, h] = area && area[3] < GB.display.at(1) / 2 ? area
            : (s => (([a, b], c, d) => [a - c, b - c, d, d])(GB.pointer, s / 2, s * 1.15))(GB.cursor);
        this.$src.csr[$].set_position(x, y).set_size(w, h);
        this.$align = area && w > 250 ? 1 / 2 : 1 / 10;
    }

    #syncApp() {
        this.app = (w => w ? Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '' : '')(GB.window);
    }

    #denyApp() {
        return this[K.APPS].length && T.xnor(this[K.APP], this[K.APPS].includes(this.app));
    }

    #denyMdf(mdf = GB.pointer.at(2)) {
        return this.$src.act[K.PSV] && !(mdf & Clutter.ModifierType.MOD1_MASK);
    }

    #onDwell(_a, mdf, [x, y]) {
        let {box, bar, act} = this.$src;
        if(this.$lck.dwell.pop() || box.prect?.contains_point(new Graphene.Point().init(x, y)) || act.$src.ocr.hub?.[K.OCRS] === OCRMode.AREA ||
            (box.visible && box.$view.hover) || (bar.visible && bar.$box.hover) || this.#denyMdf(mdf)) return;
        act.OCR('--quiet');
    }

    #postRun(output, result) {
        if(result & Result.SHOW) this.print(output);
        if(result & Result.COPY) F.copy(output);
        if(result & Result.SELECT) F.copy(output, true);
        if(result & Result.COMMIT) this.$src.act.commit(output);
    }

    async #runSh({command: cmd, result}) {
        let env = {LDWORD: this.txt, LDAPPID: this.app};
        if(result) {
            await Promise.try(result & Result.AWAIT ? () => this.$src.wait.invoke(cmd, env) : () => this.$src.act.execute(cmd, env))
            .then(output => this.#postRun(output, result)).catch(e => F.Source.cancelled(e) || this.print(e.message, true));
        } else {
            T.execute(cmd, env).catch(logError);
        }
    }

    #runJS({command, result}) {
        try {
            let output = evaluate(command, {
                LDWORD: this.txt, LDAPPID: this.app,
                open: F.open, copy: F.copy,
                key: x => this.$src.act.stroke(x),
                search: x => Main.overview[$].show().searchEntry.set_text(x),
            });
            if(result) this.#postRun(String(output), result);
        } catch(e) {
            this.print(e.message, true);
        }
    }

    dispelAll() {
        ['box', 'bar'].forEach(x => this.$src[x].dispel());
    }

    async runCmd(cmd) {
        cmd.type ? this.#runJS(cmd) : await this.#runSh(cmd);
    }

    async swift(name) {
        let cmd = this.$src.act.getCommand(name);
        if(allowed(cmd, this.app, this.txt)) await this.runCmd(cmd);
    }

    popup() {
        this.$src.bar[$].setPosition(this.$src.csr, 1 / 2).summon(this.app, this.txt);
    }

    print(info, error) {
        this.$src.box[$].setPosition(this.$src.csr, this.$align).summon(info, this.txt, error);
    }

    async run(type, text, info, area) {
        this.#setSourceArea(area);
        let [kind, name] = type === 'auto' ? [Triggers[this.$src.act[K.TRG]]] : type.split(':');
        this.txt = text || (kind === 'print' ? 'Oops' : await F.paste(true));
        if(this[K.SPLC]) this.txt = this.txt.replace(/(?<![\p{Sentence_Terminal}\n])\n+/gu, ' ');
        switch(kind) {
        case 'swift': await this.swift(name); break;
        case 'popup': this.popup(); break;
        case 'print': this.print(info, !text); break;
        }
    }

    RunAsync([type, text, info, area], invocation) {
        return Promise.try(() => this.run(type, text, info, area.length === 4 ? area : null))
            .catch(T.nop).finally(() => invocation.return_value(null));
    }

    async GetAsync([props], invocation) {
        try {
            await DBusSSS.checkInvocation(invocation);
            invocation.return_value(new GLib.Variant('(aai)', [props.map(x => {
                switch(x) {
                case 'display': return GB.display;
                case 'pointer': return GB.pointer.slice(0, 2);
                case 'focused': return (r => r ? [r.x, r.y, r.width, r.height] : null)(GB.window?.get_frame_rect?.());
                default: throw Error(`Unknown property: ${x}`);
                }
            })]));
        } catch(e) {
            if(e instanceof GLib.Error) invocation.return_gerror(e);
            else invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message);
        }
    }

    OCR(args) {
        this[$].dispelAll().$src.act.OCR(args);
    }
}

export default class extends F.Extension { $klass = LightDict; }
