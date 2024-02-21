// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import {Field, Result} from './const.js';
import {ROOT, BIND, noop, gprops, execute, pickle, hook, has} from './util.js';

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

const {_, _GTK, getSelf, wrapValue}  = UI;

class PrefPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param) {
        super(param);
        let prefs = new Adw.PreferencesGroup();
        this._add = widget => prefs.add(widget);
        this.add(prefs);
    }
}

class AppItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprops({
                selected: ['boolean', false],
                app: ['object', Gio.DesktopAppInfo],
            }),
        }, this);
    }

    constructor(app) {
        super();
        this.app = app;
        this.toggle = () => { this.selected = !this.selected; };
    }
}

class AppLabel extends UI.IconLabel {
    static {
        GObject.registerClass(this);
    }

    constructor(...args) {
        super(...args);
        this.append(this._check = new Gtk.Image({icon_name: 'object-select-symbolic'}));
    }

    bindItem(item) {
        this.setContent(item.app.get_icon(), item.app.get_display_name());
        this._binding = item.bind_property('selected', this._check, 'visible', GObject.BindingFlags.SYNC_CREATE);
    }

    unbindItem() {
        this._binding.unbind();
    }
}

class AppsDialog extends UI.AppDialog {
    static {
        GObject.registerClass(this);
    }

    _buildWidgets(param) {
        let factory = hook({
                setup: (_f, x) => x.set_child(new AppLabel('application-x-executable-symbolic')),
                bind: (_f, x) => x.get_child().bindItem(x.get_item()),
                unbind: (_f, x) => x.get_child().unbindItem(),
            }, new Gtk.SignalListItemFactory()),
            filter = Gtk.CustomFilter.new(null),
            model = new Gio.ListStore({item_type: AppItem}),
            select = new Gtk.SingleSelection({model: new Gtk.FilterListModel({model, filter})}),
            content = hook({activate: () => select.get_selected_item().toggle()},
                new Gtk.ListView({single_click_activate: true, model: select, factory, vexpand: true}));
        if(param?.no_display) Gio.AppInfo.get_all().forEach(x => model.append(new AppItem(x)));
        else Gio.AppInfo.get_all().filter(x => x.should_show()).forEach(x => model.append(new AppItem(x)));
        this.getSelected = () => [...model].filter(x => x.selected).map(x => x.app.get_id()).join(',');
        this.initSelected = s => [...model].forEach(x => { x.selected = s.has(x.app.get_id()); });
        filter.set_search = s => filter.set_filter_func(s ? (a => x => a.has(x.app.get_id()))(new Set(Gio.DesktopAppInfo.search(s).flat())) : null);
        return {content, filter};
    }
}

class Apps extends UI.DialogButtonBase {
    static {
        GObject.registerClass(this);
    }

    constructor(tip1, tip2) {
        super(null);
        if(tip2) this._btn.set_tooltip_text(tip2);
        this._btn.set_icon_name('list-add-symbolic');
        this._box = new UI.Box(null, {hexpand: true, can_focus: false, tooltip_text: tip1 || ''});
        let scroll = new Gtk.ScrolledWindow({child: this._box, vexpand: false, css_name: 'entry', vscrollbar_policy: Gtk.PolicyType.NEVER});
        this.prepend(scroll);
        this.value = '';
    }

    _buildDialog() {
        return new AppsDialog();
    }

    _genApp(id) {
        let app = Gio.DesktopAppInfo.new(id);
        return hook({clicked: () => { this._gvalue.delete(id); this.value = [...this._gvalue].join(','); }}, app
            ? new Gtk.Button({child: new Gtk.Image({gicon: app.get_icon()}), tooltip_text: app.get_display_name(), has_frame: false})
            : new Gtk.Button({icon_name: 'help-browser-symbolic', tooltip_text: id, has_frame: false}));
    }

    _onClick() {
        return this._dlg.choose_sth(this.get_root(), this._gvalue);
    }

    _setValue(v) {
        this._value = v;
        this._gvalue = new Set(v ? v.split(',') : null);
        if(this._box) [...this._box].forEach(x => this._box.remove(x));
        if(this._value) this._gvalue.forEach(x => this._box.append(this._genApp(x)));
    }
}

class SideItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprops({
                name: ['string', 'Name'],
                enable: ['boolean', false],
            }),
        }, this);
    }

    constructor({enable, name}) {
        super();
        this.name = name || 'Name';
        this.enable = enable ?? false;
    }
}

class SideRow extends Gtk.ListBoxRow {
    static {
        GObject.registerClass({
            Signals: {
                dropped: {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT]},
                changed: {param_types: [GObject.TYPE_UINT, GObject.TYPE_STRING]},
                toggled: {param_types: [GObject.TYPE_UINT, GObject.TYPE_BOOLEAN]},
            },
        }, this);
    }

    constructor(item, group, uuid, param) {
        super({hexpand: false, ...param});
        this._uuid = uuid;
        this._group = group;
        this._btn = hook({toggled: () => this.emit('toggled', this.get_index(), this._btn.active)},
            new UI.Check({group: group ? new UI.Check() : null}));
        this._txt = hook({changed: () => !this._txt.editing && this.emit('changed', this.get_index(), this._txt.text)},
            new Gtk.EditableLabel({max_width_chars: 9}));
        this._img = new Gtk.Image({icon_name: 'open-menu-symbolic'});
        this.set_child(new UI.Box([this._btn, this._txt, this._img], {spacing: 5, margin_end: 5}));
        this._txt.get_delegate().connect('activate', () => this.emit('changed', this.get_index(), this._txt.text));
        item.bind_property('enable', this._btn, 'active', BIND);
        item.bind_property('name', this._txt, 'text', BIND);
        this._buildDND(this._img);
    }

    _buildDND(handle) {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        handle.add_controller(hook({
            prepare: () => Gdk.ContentProvider.new_for_value(this),
            drag_begin: (_src, drag) => {
                let width_request = this.get_width(),
                    height_request = this.get_height(),
                    widget = new SideRow(new SideItem({name: this._txt.text, enable: this._btn.active}),
                        this._group ? new UI.Check() : null, '', {width_request, height_request, css_name: 'ld-dragging'});
                Gtk.DragIcon.get_for_drag(drag).set_child(widget);
                drag.set_hotspot(width_request - this._img.get_width() / 2, height_request - this._img.get_height() / 2);
            },
        }, new Gtk.DragSource({actions: Gdk.DragAction.MOVE})));
        this.add_controller(hook({
            motion: (_t, _x, y) => {
                let top = y < this.get_height() / 2;
                this.add_css_class(top ? 'ld-drop-top' : 'ld-drop-bottom');
                this.remove_css_class(top ? 'ld-drop-bottom' : 'ld-drop-top');
                return Gdk.DragAction.MOVE;
            },
            drop: (_t, item, _x, y) => {
                this._clearDropStyle();
                if(item._uuid !== this._uuid) return false;
                this.emit('dropped', item.get_index(), this.get_index() + (y > this.get_height() / 2));
                return true;
            },
            leave: () => this._clearDropStyle(),
        }, Gtk.DropTarget.new(SideRow, Gdk.DragAction.MOVE)));
    }

    _clearDropStyle() {
        this.remove_css_class('ld-drop-top');
        this.remove_css_class('ld-drop-bottom');
    }
}

class ResultRows extends GObject.Object {
    static {
        GObject.registerClass(wrapValue('uint', 0, GLib.MAXINT32, 0), this);
    }

    _addToGroup(group) {
        this._addToGroup = noop;
        [
            [Result.SHOW,   _('Show result'),   new UI.Switch()],
            [Result.COPY,   _('Copy result'),   new UI.Switch()],
            [Result.WAIT,   _('Await result'),  new UI.Switch()],
            [Result.SELECT, _('Select result'), new UI.Switch()],
            [Result.COMMIT, _('Commit result'), new UI.Switch()],
        ].forEach(([mask, description, widget]) => {
            group.add(new UI.PrefRow([description], widget));
            this.bind_property_full('value', widget, 'active', BIND, (_b, data) => (x => [x ^ widget.state, x])(!!(data & mask)),
                (_b, data) => [!!(this.value & mask) ^ data, this.value ^ mask]);
        });
    }
}

class PrefsAbout extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this._add(new UI.Box([this._buildIcon(gset), this._buildInfo(), this._buildTips(), new Gtk.Box({vexpand: true}),
            this._buildLicense()], {orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30, valign: Gtk.Align.FILL}, false));
    }

    _buildIcon(gset) {
        return new UI.Box(gset.get_value(Field.PCMDS)
            .recursiveUnpack()
            .slice(0, gset.get_uint(Field.PGSZ))
            .flatMap(({icon}) => icon ? [icon] : [])
            .reduce((p, x, i) => Object.assign(p, {[i]: x}), ['accessories-dictionary-symbolic'])
            .map(icon_name => new Gtk.Image({icon_name, icon_size: Gtk.IconSize.LARGE})),
        {halign: Gtk.Align.CENTER, margin_bottom: 30}, false);
    }

    _buildLabel(label) {
        return new Gtk.Label({label, wrap: true, use_markup: true, justify: Gtk.Justification.CENTER});
    }

    _buildInfo() {
        let {name, version, url} = getSelf().metadata;
        return this._buildLabel([
            `<b><big>${name}</big></b>`,
            _('Version %d').format(version),
            _('Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.'),
            `<span><a href="${url}">${_GTK('Website')}\n</a></span>`,
        ].join('\n\n'));
    }

    _buildTips() {
        return new Gtk.MenuButton({
            popover: new Gtk.Popover({
                child: new UI.Box([
                    _('Get the selected text via the <b>LDWORD</b> (environment) variable'),
                    _('Leave RegExp/App list blank for no such restriction'),
                    _('Middle click the panel to copy the result to clipboard'),
                    _('Simulate keyboard input in JS statement: <tt>key("ctrl+c")</tt>'),
                    _('Visit the <u>website</u> above for more information and support'),
                ].map((x, i) => new Gtk.Label({halign: Gtk.Align.START, use_markup: true, label: `${i}. ${x}`})),
                {spacing: 2, orientation: Gtk.Orientation.VERTICAL}, false),
            }),
            label: _('Tips'), halign: Gtk.Align.CENTER, direction: Gtk.ArrowType.NONE,
        });
    }

    _buildLicense() {
        let url = 'https://www.gnu.org/licenses/gpl-3.0.html',
            gpl = 'GNU General Public License, version 3 or later',
            info = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';
        return this._buildLabel(`<small>\n\n${_GTK(info).format(url, _GTK(gpl))}</small>`);
    }
}

class PrefsBasic extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this._buildWidgets(gset);
        this._buildUI();
        this._buildOCR(gset);
    }

    _buildWidgets(gset) {
        this._blk = UI.block({
            TSTP: [new UI.Switch()],
            STRY: [new UI.Switch()],
            TIP:  [new UI.Switch()],
            HDTT: [new UI.Switch()],
            PGSZ: [new UI.Spin(1, 10, 1)],
            ATHD: [new UI.Spin(1000, 10000, 250)],
            LCMD: [new UI.LazyEntry('notify-send "$LDWORD"')],
            RCMD: [new UI.LazyEntry('notify-send "$LDWORD"')],
            TFLT: [new UI.LazyEntry('^[^\\n\\.\\t/,{3,50}$')],
            APPS: [new Apps(_('Click the app icon to remove'))],
            PSV:  [new UI.Drop([_('Proactive'), _('Passive')])],
            APP:  [new UI.Drop([_('Allowlist'), _('Blocklist')])],
            TRG:  [new UI.Drop([_('Swift'), _('Popup'), _('Disable')])],
        }, gset);
    }

    _buildOCR(gset) {
        // EGO: if(GLib.access(`${ROOT}/ldocr.py`, 0)) return;
        Object.assign(this._blk, UI.block({
            KEY:  [new UI.Check()],
            DOCR: [new UI.Switch()],
            OCRP: [new UI.LazyEntry()],
            OCRS: [new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line'), _('Dialog')])],
            OCR:  [new Adw.ExpanderRow({title: _('OCR'), subtitle: _('Depends on python-opencv and python-pytesseract'), show_enable_switch: true}), 'enable-expansion'],
        }, gset));
        this._blk.KEYS = new UI.Keys({gset, key: Field.KEYS});
        this._blk.HELP = new Gtk.MenuButton({label: _('Parameters'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER});
        this._buildHelpPopover().then(scc => this._blk.HELP.set_popover(scc)).catch(noop);
        [
            [this._blk.KEY, [_('Shortcut')], this._blk.KEYS],
            [[_('Dwell OCR')], this._blk.DOCR],
            [[_('Work mode')], this._blk.OCRS],
            [this._blk.HELP, [], this._blk.OCRP],
        ].forEach(xs => this._blk.OCR.add_row(new UI.PrefRow(...xs)));
        this._add(this._blk.OCR);
    }

    _buildUI() {
        [
            [[_('Enable systray')], this._blk.STRY],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this._blk.PSV, this._blk.TRG],
            [[_('App list')], this._blk.APPS, this._blk.APP],
        ].forEach(xs => this._add(new UI.PrefRow(...xs)));
        [this._buildExpander(_('Other'),
            [[_('Trim blank lines')], this._blk.TSTP],
            [[_('Autohide interval')], this._blk.ATHD],
            [[_('RegExp filter')], this._blk.TFLT]),
        this._buildExpander(_('Panel'),
            [[_('Hide title')], this._blk.HDTT],
            [[_('Right command'), _('Right click to run and hide panel')], this._blk.RCMD],
            [[_('Left command'), _('Left click to run')], this._blk.LCMD]),
        this._buildExpander(_('Popup'),
            [[_('Enable tooltip')], this._blk.TIP],
            [[_('Page size')], this._blk.PGSZ])].forEach(x => this._add(x));
    }


    _buildExpander(title, ...list) {
        let expander = new Adw.ExpanderRow({title});
        list.forEach(xs => expander.add_row(new UI.PrefRow(...xs)));
        return expander;
    }

    async _buildHelpPopover() {
        try {
            let label = await execute(`python ${ROOT}/ldocr.py -h`);
            return new Gtk.Popover({child: new Gtk.Label({label})});
        } catch(e) {
            return new Gtk.Popover({child: new Gtk.Label({label: e.message})});
        }
    }
}

class PrefsPopup extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset, key) {
        super(param);
        this._saveCommands = () => gset.set_value(key, pickle(this._cmds));
        this._cmds = gset.get_value(key).recursiveUnpack();
        this._buildUI(key);
    }

    _buildUI(key) {
        this._pane = this._buildPane();
        let side = this._buildSide(this._cmds, key === Field.SCMDS);
        this._add(new Gtk.Frame({child: new UI.Box([side, new Gtk.Separator(), this._pane], {hexpand: true}, false)}));
        this._pane.set_sensitive(!!this._cmds.length);
        this._grabFocus(0);
    }

    _buildSide(cmds, group) {
        let uuid = GLib.uuid_string_random();
        this._model = new Gio.ListStore({item_type: SideItem});
        cmds.forEach(x => this._model.append(new SideItem(x)));
        this._list = hook({'row-selected': (_w, row) => row && this._onSelect()},
            new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, vexpand: true}));
        this._list.add_css_class('data-table');
        this._list.bind_model(this._model, item => hook({
            dropped: (_w, f, t) => this._onDrop(f, t),
            changed: (_w, p, v) => this._onChange(p, 'name',  v),
            toggled: (_w, p, v) => this._onChange(p, 'enable', v),
        }, new SideRow(item, group, uuid)));
        let side = new Gtk.ScrolledWindow({overlay_scrolling: false, child: this._list});
        let box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        [side, new Gtk.Separator(), this._buildTool()].forEach(x => box.append(x));
        return box;
    }

    _grabFocus(index, edit) {
        let row = this._list.get_row_at_index(index);
        this._list.select_row(row);
        if(!edit) return;
        row._txt.grab_focus();
        row._txt.start_editing();
    }

    _buildPaneWidgets() {
        return [
            ['command', '', _('Run command'),    new UI.LazyEntry('gio open "$LDWORD"')],
            ['type',    0,  _('Command type'),   new UI.Drop(['Bash', 'JS'])],
            ['icon',    '', _('Icon name'),      new UI.Icon()],
            ['result',  0,  '',                  new ResultRows()],
            ['apps',    '', _('App list'),       new Apps(_('Click the app icon to remove'), _('Allowlist'))],
            ['regexp',  '', _('RegExp matcher'), new UI.LazyEntry('(https?|ftp|file)://.*')],
            ['tooltip', '', _('Icon tooltip'),   new UI.LazyEntry('Open URL')],
        ];
    }

    _buildPane() {
        this._tmp = {};
        this._wdg = {};
        let prefs = new Adw.PreferencesGroup();
        this._buildPaneWidgets().forEach(([key, value, description, widget, property = 'value']) => {
            if(widget instanceof ResultRows) widget._addToGroup(prefs);
            else prefs.add(new UI.PrefRow([description], widget));
            widget.connect(`notify::${property}`, w => !this._syncing && this._onChange(this.selected, key, w[property]));
            this._wdg[key] = widget;
            this._tmp[key] = value;
        });
        let page = new Adw.PreferencesPage({hexpand: true});
        page.add(prefs);
        return page;
    }

    get selected() {
        return this._list.get_selected_row()?.get_index() ?? -1;
    }

    _buildTool() {
        return new UI.Box([
            ['list-add-symbolic',    _('Add'),    () => this._onAdd()],
            ['list-remove-symbolic', _('Remove'), () => this._onRemove()],
            ['edit-copy-symbolic',   _('Copy'),   () => this._onCopy()],
            ['edit-paste-symbolic',  _('Paste'),  () => this._onPaste()],
        ].map(([icon_name, tooltip_text, clicked]) => hook({clicked},
            new Gtk.Button({icon_name, tooltip_text, has_frame: false}))));
    }

    _onSelect() {
        this._syncing = true;
        let cmd = this._cmds[this.selected] ?? {};
        Object.entries({...this._tmp, ...cmd}).forEach(([k, v]) => has(this._wdg, k) && (this._wdg[k].value = v));
        this._syncing = false;
    }

    _onChange(index, key, value) {
        if(!this._cmds[index]) return;
        this._cmds[index][key] = value || undefined;
        if(key === 'enable') this._grabFocus(index);
        this._saveCommands();
    }

    _onAdd(cmd = {name: 'Name'}) {
        let index = this.selected;
        if(index === Gtk.INVALID_LIST_POSITION) index = -1;
        this._model.insert(index + 1, new SideItem(cmd));
        if(index < 0) {
            this._cmds.push(cmd);
            this._pane.set_sensitive(true);
        } else {
            this._cmds.splice(index + 1, 0, cmd);
        }
        this._grabFocus(index + 1, true);
        this._saveCommands();
    }

    _onRemove() {
        let index = this.selected;
        if(index === Gtk.INVALID_LIST_POSITION) return;
        this._model.remove(index);
        this._cmds.splice(index, 1);
        this._pane.config = this._cmds[index] || this._cmds[index - 1] || {};
        if(this._cmds.length > 0 ^ this._pane.sensitive) this._pane.set_sensitive(this._cmds.length > 0);
        this._grabFocus(Math.min(index, this._cmds.length - 1));
        this._saveCommands();
    }

    _onDrop(drag, drop) {
        let target = drop > drag ? drop - 1 : drop;
        if(drag === target) return;
        let item = new SideItem(this._model.get_item(drag));
        this._model.remove(drag);
        this._model.insert(target, item);
        this._cmds.splice(target, 0, this._cmds.splice(drag, 1).at(0));
        this._grabFocus(target);
        this._saveCommands();
    }

    _onCopy() {
        let cmd = this._cmds[this.selected];
        if(!cmd) return;
        this.get_clipboard().set(JSON.stringify(cmd));
        this.get_root().add_toast(new Adw.Toast({title: _('Content copied'), timeout: 5}));
    }

    async _onPaste() {
        try {
            this._onAdd(JSON.parse(await this.get_clipboard().read_text_async(null)));
        } catch(e) {
            this.get_root().add_toast(new Adw.Toast({title: _('Pasted content parsing failed'), timeout: 5}));
        }
    }
}

class PrefsSwift extends PrefsPopup {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset, key) {
        super(param, gset, key);
        Object.defineProperty(this, 'enabled', {
            get: () => gset.get_int(Field.SCMD),
            set: x => { x !== this.enabled && gset.set_int(Field.SCMD, x); },
        });
        this.setEnabled(this.enabled);
        gset.connect(`changed::${Field.SCMD}`, () => this.setEnabled(this.enabled));
    }

    setEnabled(index) {
        let n = this._model.get_n_items();
        for(let i = 0; i < n; i++) this._model.get_item(i).enable = i === index;
    }

    _buildPaneWidgets() {
        return super._buildPaneWidgets().filter(([x]) => x !== 'icon' && x !== 'tooltip');
    }

    _onChange(index, key, value) {
        if(key === 'enable') {
            if(!value) return;
            this.enabled = index;
            this._grabFocus(index);
        } else {
            super._onChange(index, key, value);
        }
    }

    _onAdd(_w, index, cmd) {
        cmd.enable = undefined;
        super._onAdd(_w, index, cmd);
        if(index >= 0 && this.enabled > index) this.enabled += 1;
    }

    _onRemove(_w, index) {
        super._onRemove(_w, index);
        if(this.enabled >= index) this.enabled = this.enabled === index ? -1 : this.enabled - 1;
    }

    _onMove(_w, source, target) {
        super._onMove(_w, source, target);
        if(this.enabled <= Math.max(source, target) && this.enabled >= Math.min(source, target)) {
            if(this.enabled > source) this.enabled -= 1;
            else if(this.enabled === source) this.enabled = target;
            else this.enabled += 1;
        }
    }
}

export default class PrefsWidget extends UI.Prefs {
    fillPreferencesWindow(win) {
        let provider = new Gtk.CssProvider();
        // Ref: https://gist.github.com/JMoerman/6f2fa1494847ce7b7044b99787ccc769
        provider.load_from_string(`ld-dragging { background: alpha(@window_bg_color, .85); color: @accent_color; border: 1px dashed @accent_color; border-radius: 4px; }
                                  .ld-drop-top { background: linear-gradient(to bottom, alpha(@accent_bg_color, .85) 0%, alpha(@accent_bg_color, 0) 35%); }
                                  .ld-drop-bottom { background: linear-gradient(to bottom, alpha(@accent_bg_color, 0) 65%, alpha(@accent_bg_color, .85) 100%); }`);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(`${ROOT}/icons`);
        let gset = this.getSettings();
        [
            new PrefsBasic({title: _('Basic'), icon_name: 'ld-disable-passive-symbolic'}, gset),
            new PrefsSwift({title: _('Swift'), icon_name: 'ld-swift-passive-symbolic'}, gset, Field.SCMDS),
            new PrefsPopup({title: _('Popup'), icon_name: 'ld-popup-passive-symbolic'}, gset, Field.PCMDS),
            new PrefsAbout({title: _('About'), icon_name: 'help-about-symbolic'}, gset),
        ].forEach(x => win.add(x));
    }
}
