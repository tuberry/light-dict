// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K, Result} from './const.js';

const {_, _G} = UI;
const EXE = 'application/x-executable';

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

class AppItem extends GObject.Object {
    static {
        T.enrol(this, {chosen: false, app: Gio.DesktopAppInfo});
    }

    constructor(app, callback) {
        super();
        this.app = app;
        this.toggle = (x = !this.chosen) => { this.chosen = x; callback(); };
    }
}

class Apps extends UI.DialogButtonBase {
    static {
        UI.enrol(this);
    }

    constructor(tip, param) {
        super(null, null, false, param);
        if(tip) this.$btn.set_tooltip_text(tip);
        this.$btn.set_icon_name('list-add-symbolic');
        this.$getInitial = () => new Set(this.value);
        this.prepend(this.$bin = new Gtk.ScrolledWindow({vexpand: false, cssName: 'entry', cssClasses: ['ld-apps'], vscrollbarPolicy: Gtk.PolicyType.NEVER}));
        this.bind_property_full('value', this.$bin, 'child', GObject.BindingFlags.SYNC_CREATE, (_b, x) => [true, new UI.Box(x?.map(y => this.$genApp(y)),
            {hexpand: true, tooltipText: _('Click the app icon to remove')})], null);
    }

    $genDialog(opt) {
        return new UI.Dialog(dlg => {
            let list = new Gio.ListStore({itemType: AppItem}),
                title = T.hook({clicked: () => { [...list].forEach(x => x.toggle(false)); }},
                    new Gtk.Button({child: new UI.Sign('edit-clear-symbolic', true), cssClasses: ['flat']})),
                factory = T.hook({
                    setup: (_f, x) => x.set_child(T.seq(w => w.append(w.$check = new Gtk.Image({iconName: 'object-select-symbolic'})),
                        new UI.Sign('application-x-executable-symbolic'))),
                    bind: (_f, {child, item}) => {
                        item.$bind = item.bind_property('chosen', child.$check, 'visible', GObject.BindingFlags.SYNC_CREATE);
                        child.setup(item.app.get_icon(), item.app.get_display_name());
                    },
                    unbind: (_f, {item}) => item.$bind.unbind(),
                }, new Gtk.SignalListItemFactory()),
                filter = Gtk.CustomFilter.new(null),
                select = new Gtk.SingleSelection({model: new Gtk.FilterListModel({model: list, filter})}),
                content = T.hook({activate: () => select.get_selected_item().toggle()},
                    new Gtk.ListView({singleClickActivate: true, model: select, factory, vexpand: true})),
                id, count = () => { clearTimeout(id); id = setTimeout(() => title.child.setup(null, String([...list].filter(y => y.chosen).length)), 50); };
            list.splice(0, 0, (x => opt?.noDisplay ? x : x.filter(y => y.should_show()))(Gio.AppInfo.get_all()).map(x => new AppItem(x, () => count())));
            filter.set_search = s => filter.set_filter_func(s ? (a => x => a.has(x.app.get_id()))(new Set(Gio.DesktopAppInfo.search(s).flat())) : null);
            dlg.initChosen = s => [...list].forEach(x => x.toggle(s.has(x.app.get_id()))); // TODO: Iter
            dlg.getChosen = () => [...list].filter(x => x.chosen).map(x => x.app.get_id());
            return {content, filter, title};
        });
    }

    $genApp(id) {
        let app = Gio.DesktopAppInfo.new(id);
        return T.hook({clicked: () => { this.value = this.value.filter(x => x !== id); }}, new Gtk.Button(app
            ? {child: new Gtk.Image({gicon: app.get_icon()}), tooltipText: app.get_display_name(), hasFrame: false}
            : {iconName: 'system-help-symbolic', tooltipText: id, hasFrame: false}));
    }
}

class SideItem extends GObject.Object {
    static {
        T.enrol(this, {cmd: null, enable: false});
    }

    constructor(cmd, enable = false) {
        super();
        this.cmd = cmd;
        this.enable = enable;
    }

    setup(key, value) {
        if(value) this.cmd[key] = value;
        else delete this.cmd[key];
    }
}

class SideRow extends Gtk.ListBoxRow {
    static {
        T.enrol(this, null, {
            Signals: {
                dropped: {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT]},
                changed: {param_types: [GObject.TYPE_UINT, GObject.TYPE_STRING]},
                toggled: {param_types: [GObject.TYPE_UINT, GObject.TYPE_BOOLEAN]},
            },
        });
    }

    constructor(item, group, param) {
        super({hexpand: false, ...param});
        this.$grp = group;
        this.$btn = T.hook({toggled: () => this.emit('toggled', this.get_index(), this.$btn.active)},
            new UI.Check({group: group ? new UI.Check() : null}));
        this.$txt = T.hook({changed: () => !this.$txt.editing && this.emit('changed', this.get_index(), this.$txt.text)},
            new Gtk.EditableLabel({maxWidthChars: 9}));
        this.$img = new Gtk.Image({iconName: 'list-drag-handle-symbolic'});
        this.set_child(new UI.Box([this.$btn, this.$txt, this.$img], {spacing: 5, marginEnd: 5}));
        this.$txt.get_delegate().connect('activate', () => this.emit('changed', this.get_index(), this.$txt.text));
        item.bind_property_full('cmd', this.$txt, 'text', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, v.name], null);
        if(group) item.bind_property('enable', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE);
        else item.bind_property_full('cmd', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, !!v.enable], null);
        this.$buildDND(item, this.$img);
    }

    $buildDND(item, handle) { // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        handle.add_controller(T.hook({
            prepare: () => Gdk.ContentProvider.new_for_value(this),
            drag_begin: (_s, drag) => {
                let {width: widthRequest, height: heightRequest} = this.get_allocation();
                let row = new SideRow(item, this.$grp ? new UI.Check() : null, {widthRequest, heightRequest, cssClasses: ['ld-dragging']});
                Gtk.DragIcon.get_for_drag(drag).set_child(row);
                drag.set_hotspot(widthRequest - this.$img.get_width() / 2, heightRequest - this.$img.get_height() / 2);
            },
        }, new Gtk.DragSource({actions: Gdk.DragAction.MOVE})));
        this.add_controller(T.hook({
            motion: (_t, _x, y) => {
                let top = y < this.get_height() / 2;
                this.add_css_class(top ? 'ld-drop-top' : 'ld-drop-bottom');
                this.remove_css_class(top ? 'ld-drop-bottom' : 'ld-drop-top');
                return Gdk.DragAction.MOVE;
            },
            drop: (_t, src, _x, y) => {
                this.#clearDropStyle();
                if(src.$grp !== this.$grp) return false;
                let drag = src.get_index(),
                    target = this.get_index() + (y > this.get_height() / 2),
                    drop = target > drag ? target - 1 : target;
                return T.seq(x => x && this.emit('dropped', drag, drop), drag !== drop);
            },
            leave: () => this.#clearDropStyle(),
        }, Gtk.DropTarget.new(SideRow, Gdk.DragAction.MOVE)));
    }

    #clearDropStyle() {
        this.remove_css_class('ld-drop-top');
        this.remove_css_class('ld-drop-bottom');
    }

    editName() {
        this.$txt.grab_focus();
        this.$txt.start_editing();
    }
}

class ResultRows extends GObject.Object {
    static {
        UI.enrol(this, ['uint', 0, GLib.MAXINT32, 0]);
    }

    addToPane(addRow) {
        this.addToPane = null;
        [
            [Result.SHOW,  [_('S_how result')],   new UI.Switch()],
            [Result.COPY,  [_('Cop_y result')],   new UI.Switch()],
            [Result.AWAIT, [_('A_wait result'), _('Show a spinner when running')],  new UI.Switch()],
            [Result.SELECT, [_('Se_lect result')], new UI.Switch()],
            [Result.COMMIT, [_('Co_mmit result')], new UI.Switch()],
        ].forEach(([mask, titles, widget]) => {
            addRow(titles, widget);
            this.bind_property_full('value', widget, 'active', T.BIND, (_b, v) => (x => [x ^ widget.active, x])(!!(v & mask)),
                (_b, v) => [!!(this.value & mask) ^ v, this.value ^ mask]);
        });
    }
}

class PrefsBasic extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        return [
            [K.APPS, new Apps()],
            [K.KEYS, new UI.Keys()],
            [K.OCR,  new UI.Switch()],
            [K.DOCR, new UI.Switch()],
            [K.HEAD, new UI.Switch()],
            [K.TRAY, new UI.Switch()],
            [K.TIP,  new UI.Switch()],
            [K.SPLC, new UI.Switch()],
            [K.OCRP, new UI.Entry('-h')],
            [K.TFLT, new UI.Entry('\\W')],
            [K.PGSZ, new UI.Spin(1, 10, 1)],
            [K.WAIT, new UI.Spin(1000, 20000, 250)],
            [K.PSV,  new UI.Drop([_('Proactive'), _('Passive')])],
            [K.APP,  new UI.Drop([_('Whitelist'), _('Blacklist')])],
            [K.TRG,  new UI.Drop([_('Swift'), _('Popup'), _('Disable')])],
            [K.OCRS, new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line'), _('Dialog')])],
            [K.LCMD, new UI.Entry('notify-send "$LDWORD"', [EXE], _('get captured text with the environment variable LDWORD'))],
            [K.RCMD, new UI.Entry('notify-send "$LDWORD"', [EXE], _('get captured text with the environment variable LDWORD'))],
        ];
    }

    $buildUI() {
        let opencv = '<a href="https://github.com/opencv/opencv-python">opencv-python</a>',
            tesseract = '<a href="https://github.com/madmaze/pytesseract">pytesseract</a>',
            ocr = T.seq(w => T.execute(`python ${T.ROOT}/ldocr.py -h`).then(x => w.setup(x, {selectable: true, cssClasses: ['ld-popover']})).catch(e => w.setup(e.message, null, true)),
                new UI.Help(null, null, {popover: T.hook({'notify::visible': w => w.child.select_region(-1, -1)}, new Gtk.Popover())})); // HACK: workaround for full selection on popup
        this.$add([null, [
            [[_('Enable s_ystray'), _('Scroll to toggle the trigger style')], K.TRAY],
            [[_('_Trigger style'), _('Passive means pressing Alt to trigger')], K.PSV, K.TRG],
            [[_('_App list')], K.APPS, K.APP],
            [[_('RegE_xp filter')], K.TFLT],
            [[_('Autohide inter_val')], K.WAIT, UI.Spin.unit(_('ms'))],
            [[_('Sp_lice text'), _('Try to replace redundant line breaks with spaces')], K.SPLC],
        ]], [[[_('Panel'), _('Middle click to copy the result')]], [
            [[_('_Enable title')], K.HEAD],
            [[_('Ri_ght command'), _('Right click to run and hide panel')], K.RCMD],
            [[_('Le_ft command'), _('Left click to run')], K.LCMD],
        ]], [[[_('Popup'), _('Scroll to flip pages')]], [
            [[_('Enable toolt_ip')], K.TIP],
            [[_('Page si_ze')], K.PGSZ],
        ]], [[[_('OCR'), `${_('Depends on: ')} ${opencv} &amp; ${tesseract}`], K.OCR], [
            [[_('Sho_rtcut')], K.KEYS],
            [[_('_Dwell OCR')], K.DOCR],
            [[_('_Work mode')], K.OCRS],
            [[_('Other para_meters')], ocr, K.OCRP],
        ]]);
    }
}

class PrefsPopup extends UI.Page {
    static {
        UI.enrol(this);
    }

    constructor(gset, param, field) {
        super(gset, param);
        this.$tie([[field, this]]);
        this.$add([null, [new Gtk.Frame({child: new UI.Box([this.$genSide(this.value, field), this.$genPane()], {vexpand: false, cssName: 'list'})})]]);
        this.grabFocus(0); // init pane
    }

    $save(func, grab, name, pane) {
        func(this.$cmds);
        this.value = [...this.$cmds].map(x => x.cmd);
        if(grab >= 0) this.grabFocus(grab, name);
        if(pane) this.$updatePaneSensitive(this.$cmds.nItems > 0);
    }

    $genSide(cmds, field) {
        this.$cmds = new Gio.ListStore({itemType: SideItem});
        this.$cmds.splice(0, 0, cmds.map(x => new SideItem(x)));
        this.$list = T.hook({'row-selected': (_w, row) => row && this.$onSelect(row.get_index())},
            new Gtk.ListBox({selectionMode: Gtk.SelectionMode.SINGLE, vexpand: true}));
        this.$list.add_css_class('data-table');
        this.$list.bind_model(this.$cmds, item => T.hook({
            dropped: (_w, f, t) => this.$onDrop(f, t),
            changed: (_w, p, v) => this.$onChange(p, 'name',  v),
            toggled: (_w, p, v) => this.$onChange(p, 'enable', v),
        }, new SideRow(item, field === K.SCMDS)));
        return UI.Box.newV([this.$genTools(), new Gtk.Separator(), new Gtk.ScrolledWindow({overlayScrolling: false, child: this.$list})]);
    }

    grabFocus(index, name) {
        let row = this.$list.get_row_at_index(index);
        this.$list.select_row(row);
        if(name) row.editName();
    }

    $genPaneWidgets() {
        return {
            command: ['', [_('_Run command')],    new UI.Entry('gio open "$LDWORD"', [EXE])],
            type:    [0,  [_('_Command type')],   new UI.Drop(['Bash', 'JS']), new UI.Help(({h, d}) =>
                [h(_('Bash environment variable')), d([
                    'LDWORD', _('the captured text'),
                    'LDAPPID', _('the focused app'),
                ]), h(_('JS script statement')), d([
                    "open('URI')", _('open <tt>URI</tt> with default app'),
                    "key('super+a')", _('simulate keyboard input'),
                    'copy(LDWORD)', _('copy <tt>LDWORD</tt> to clipboard'),
                    'search(LDWORD)', _('search <tt>LDWORD</tt> in Overview'),
                    'LDWORD.trim()', _('some native functions'),
                ])])],
            icon:    ['', [_('_Icon name')],      new UI.Icon()],
            result:  [0,  [],                     new ResultRows()],
            apps:    [[], [_('_App list')],       new Apps(_('Whitelist'))],
            regexp:  ['', [_('RegE_xp matcher')], new UI.Entry('(https?|ftp|file)://.*')],
            tooltip: ['', [_('Ic_on tooltip')],   new UI.Entry('Open URL')],
        };
    }

    $genPane() {
        let ret = new Adw.PreferencesGroup({hexpand: true});
        let addRow = ([title, subtitle = ''], widget, help) => ret.add(T.seq(w => [help, widget].forEach(x => x && w.add_suffix(x)),
            new Adw.ActionRow({title, subtitle, activatableWidget: widget, useUnderline: true})));
        this.$updatePaneSensitive = x => { if(!x) this.$onSelect(); ret.set_sensitive(x); };
        this.$pane = T.omap(this.$genPaneWidgets(), ([key, [fallback, titles, widget, help]]) => {
            widget instanceof ResultRows ? widget.addToPane(addRow) : addRow(titles, widget, help);
            widget.connect('notify::value', ({value}) => !this.$syncing && this.$select(p => this.$onChange(p, key, value)));
            widget.$fallback = fallback;
            return [[key, widget]];
        });
        return ret;
    }

    $genTools() {
        return new UI.Box([
            ['list-add-symbolic',    _('Add'),    () => this.$onAdd()],
            ['list-remove-symbolic', _('Remove'), () => this.$select(p => this.$onRemove(p))],
            ['edit-copy-symbolic',   _('Copy'),   () => this.$select(p => this.$onCopy(p))],
            ['edit-paste-symbolic',  _('Paste'),  () => this.$onPaste()],
        ].map(([x, y, z]) => T.hook({clicked: z}, new Gtk.Button({iconName: x, tooltipText: y, hasFrame: false}))));
    }

    get selected() {
        return this.$list.get_selected_row()?.get_index() ?? -1;
    }

    $select(callback) {
        let pos = this.selected;
        if(pos >= 0) callback(pos);
    }

    $onSelect(pos = this.selected) {
        this.$syncing = true;
        let cmd = pos < 0 ? {} : this.$cmds.get_item(pos).cmd;
        for(let k in this.$pane) this.$pane[k].value = cmd[k] ?? this.$pane[k].$fallback;
        this.$syncing = false;
    }

    $onChange(pos, key, value) {
        this.$save(x => x.get_item(pos).setup(key, value), key === 'enable' ? pos : -1);
    }

    $onAdd(cmd = {name: 'Name'}, pos = this.selected + 1) {
        this.$save(x => x.insert(pos, new SideItem(cmd)), pos, true, true);
    }

    $onDrop(drag, drop) {
        this.$save(x => { let item = x.get_item(drag); x.remove(drag); x.insert(drop, item); }, drop);
    }

    $onRemove(pos) {
        this.$save(x => { let item = x.get_item(pos); x.remove(pos); this.$toastRemove(item); }, Math.min(pos, this.$cmds.nItems - 2), false, true);
    }

    $toastRemove(item) {
        this.get_root().add_toast(T.hook({'button-clicked': () => this.$save(x => x.append(item), this.$cmds.nItems, true, true)},
            new Adw.Toast({title: _('Removed <i>%s</i> command').format(item.cmd.name ?? ''), buttonLabel: _G('_Undo')})));
    }

    $onCopy(pos) {
        let {cmd} = this.$cmds.get_item(pos);
        this.get_clipboard().set(JSON.stringify(cmd));
        this.$toast(_('Copied <i>%s</i> command').format(cmd.name ?? ''));
    }

    async $onPaste() {
        try {
            let cmd = JSON.parse(await this.get_clipboard().read_text_async(null));
            this.$onAdd(T.omap(cmd, ([k, v]) => Object.hasOwn(this.$pane, k) || k === 'name' || k === 'enable' ? [[k, v]] : []));
        } catch(e) {
            this.$toast(_('Failed to parse pasted command'));
        }
    }

    $toast(title) {
        this.get_root().add_toast(new Adw.Toast({title, timeout: 7}));
    }
}

class PrefsSwift extends PrefsPopup {
    static {
        T.enrol(this, {enabled: ['int', -1, GLib.MAXINT32, -1], value: null}); // HACK: workaround for the trait overwrite rather than extend the super
    }

    constructor(gset, param, field) {
        super(gset, param, field);
        this.connect('notify::enabled', () => [...this.$cmds].forEach((x, i) => { x.enable = i === this.enabled; }));
        this.$tie([[K.SCMD, this, 'enabled']]);
    }

    $genPaneWidgets() {
        let {icon: i_, tooltip: t_, ...ret} = super.$genPaneWidgets();
        return ret;
    }

    $onChange(pos, key, value) {
        if(key === 'enable') {
            if(!value) return;
            this.enabled = pos;
            this.grabFocus(pos);
        } else {
            super.$onChange(pos, key, value);
        }
    }

    $onAdd(cmd = {name: 'Name'}, pos = this.selected + 1) {
        delete cmd.enable;
        super.$onAdd(cmd, pos);
        if(this.enabled > pos) this.enabled += 1;
    }

    $onRemove(pos = this.selected) {
        super.$onRemove(pos);
        if(this.enabled > pos) this.enabled -= 1;
        else if(this.enabled === pos) this.enabled = -1;
    }

    $onDrop(drag, drop) {
        super.$onDrop(drag, drop);
        if(this.enabled > Math.max(drag, drop) || this.enabled < Math.min(drag, drop)) return;
        if(this.enabled > drag) this.enabled -= 1;
        else if(this.enabled === drag) this.enabled = drop;
        else this.enabled += 1;
    }
}

export default class extends UI.Prefs {
    fillPreferencesWindow(win) {
        let path = '/org/gnome/shell/extensions/light-dict/';
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_resource_path(`${path}icons`);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), T.seq(p => p.load_from_resource(`${path}theme/style.css`),
            new Gtk.CssProvider()), Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION); // HACK: unable (too late) to win.set_resource_base_path after inited (promised)
        let gset = this.getSettings();
        [
            new PrefsBasic(gset, {title: _('_Basic'), iconName: 'applications-system-symbolic'}),
            new PrefsSwift(gset, {title: _('_Swift'), iconName: 'ld-swift-passive-symbolic'}, K.SCMDS),
            new PrefsPopup(gset, {title: _('_Popup'), iconName: 'ld-popup-passive-symbolic'}, K.PCMDS),
        ].forEach(x => win.add(x));
    }
}
