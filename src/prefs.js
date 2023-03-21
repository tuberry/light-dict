// vim:fdm=syntax
// by tuberry
/* exported init fillPreferencesWindow */
'use strict';

const { Adw, Gtk, GObject, Gio, GLib, Gdk, Gsk, Graphene } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { _, _GTK, grect, noop, gparam, execute } = Me.imports.util;
const { Field } = Me.imports.const;
const UI = Me.imports.ui;

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

function init() {
    ExtensionUtils.initTranslations();
}

function fillPreferencesWindow(win) {
    let provider = new Gtk.CssProvider();
    // Ref: https://gist.github.com/JMoerman/6f2fa1494847ce7b7044b99787ccc769
    provider.load_from_data(`.ld-drop-up { background: linear-gradient(to bottom, #000a 0%, #0000 35%); }
                            .ld-drop-down { background: linear-gradient(to bottom, #0000 65%, #000a 100%); }
                            .ld-drop-up-dark { background: linear-gradient(to bottom, #fffa 0%, #fff0 35%); }
                            .ld-drop-down-dark { background: linear-gradient(to bottom, #fff0 65%, #fffa 100%); }`, -1);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(Me.dir.get_child('icons').get_path());
    let gset = ExtensionUtils.getSettings();
    [
        new LightDictBasic({ title: _('Basic'), icon_name: 'ld-disable-passive-symbolic' }, gset),
        new LightDictJSON({ title: _('Swift'),  icon_name: 'ld-swift-passive-symbolic' }, gset, Field.SCMDS),
        new LightDictJSON({ title: _('Popup'),  icon_name: 'ld-popup-passive-symbolic' }, gset, Field.PCMDS),
        new LightDictAbout({ title: _('About'), icon_name: 'help-about-symbolic' }, gset),
    ].forEach(x => win.add(x));
}

class PrefPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        this._group = new Adw.PreferencesGroup();
        this.add(this._group);
    }

    _add(widget) {
        this._group.add(widget);
    }
}

class AppsBox extends UI.Box {
    static {
        GObject.registerClass({
            Properties: {
                value: gparam('string', 'value', ''),
            },
            Signals: {
                changed: { param_types: [GObject.TYPE_STRING] },
            },
        }, this);
    }

    constructor(tip1, tip2) {
        super();
        this._box = new UI.Box(null, { hexpand: true, tooltip_text: tip1 || ''  });
        this._btn = new Gtk.Button({ tooltip_text: tip2 || '', icon_name: 'list-add-symbolic' });
        let scroll = new Gtk.ScrolledWindow({ child: this._box, css_name: 'entry', vscrollbar_policy: Gtk.PolicyType.NEVER });
        this._btn.connect('clicked', this._onClick.bind(this));
        [scroll, this._btn].forEach(x => this.append(x));
    }

    _buildDialog() {
        this._dlg = new UI.AppDialog();
        this._dlg.connect('selected', (_x, id) => {
            if(this.value.includes(id)) return;
            this._setValue(this._value ? `${this._value},${id}` : id);
            this._appendApp(id);
        });
    }

    _onClick() {
        if(!this._dlg) this._buildDialog();
        this._dlg.present();
        let root = this.get_root();
        if(this._dlg.transient_for !== root) this._dlg.set_transient_for(root);
    }

    set value(value) {
        if(value === this.value) return;
        this._value = value;
        let items = this._box.observe_children();
        while(items.get_n_items() > 0) this._box.remove(items.get_item(0));
        this._value.split(',').forEach(a => this._appendApp(a));
    }

    get value() {
        return this._value ?? '';
    }

    _appendApp(id) {
        let a = Gio.DesktopAppInfo.new(id);
        let btn = a ? new Gtk.Button({ child: new Gtk.Image({ gicon: a.get_icon() }), tooltip_text: a.get_display_name(), has_frame: false })
            : new Gtk.Button({ icon_name: 'help-browser-symbolic', tooltip_text: id, has_frame: false });
        btn.connect('clicked', w => {
            this._setValue(this.value.split(',').filter(x => x !== id).join(','));
            this._box.remove(w);
        });
        this._box.append(btn);
    }

    _setValue(v) {
        this._value = v;
        this.notify('value');
        this.emit('changed', this.value);
    }

    vfunc_mnemonic_activate() {
        this._btn.activate();
    }
}

class SideItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                name: gparam('string', 'name', 'Name'),
                enable: gparam('boolean', 'enable', false),
            },
        }, this);
    }

    constructor(param) {
        super();
        if(param) Object.assign(this, param);
    }

    copy() {
        return new SideItem({ enable: this.enable, name: this.name });
    }

    from_string(str) {
        let { enable, name } = JSON.parse(str);
        this.name = name || 'Name';
        this.enable = enable ?? false;
        return this;
    }
}

class SideRow extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                drag: {},
                edit: { param_types: [GObject.TYPE_STRING] },
                drop: { param_types: [GObject.TYPE_BOOLEAN] },
                toggle: { param_types: [GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(group) {
        super({ spacing: 5, hexpand: false });
        this._btn = new Gtk.CheckButton({ group });
        this._btn.connect('toggled', () => this._emit('toggle', this._btn.active));
        this._txt = new Gtk.EditableLabel({ max_width_chars: 9 });
        this._txt.get_delegate().connect('activate', () => this._emit('edit', this._txt.text));
        this._txt.connect('changed', () => !this._txt.get_position() && this._emit('edit', this._txt.text));
        this._img = new Gtk.Image({ icon_name: 'open-menu-symbolic' });
        ['_btn', '_txt', '_img'].forEach(x => this.append(this[x]));
        this._buildDND(group);
    }

    _buildDND(group) {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        this._group = !group;
        let drag = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
        drag.connect('prepare', dg => {
            this.emit('drag');
            let ss = new Gtk.Snapshot(),
                { width: w, height: h } = this.get_allocation(),
                { width: a, height: b } = this._img.get_allocation(),
                bd = new Gsk.RoundedRect().init(grect(w, h), ...Array(4).fill(new Graphene.Size()));
            ss.append_color(this.get_color().red ? UI.grgba('#3584e4').at(1) : UI.grgba('white').at(1), grect(w, h));
            ss.append_border(bd, Array(4).fill(1), Array(4).fill(UI.grgba('black').at(1)));
            new Gtk.WidgetPaintable({ widget: this }).snapshot(ss, w, h);
            dg.set_icon(ss.to_paintable(null), w - a / 2, h - b / 2);
            return Gdk.ContentProvider.new_for_value(this);
        });
        this._img.add_controller(drag);
        let drop = Gtk.DropTarget.new(this.constructor.$gtype, Gdk.DragAction.MOVE);
        UI.conns(drop, ['motion', (_a, _x, y) => {
            let dark = this.get_color().red ? '-dark' : '';
            let [add, del] = y > this.get_height() / 2 ? ['down', 'up'] : ['up', 'down'];
            this.add_css_class(`ld-drop-${add}${dark}`);
            ['', '-dark'].forEach(z => this.remove_css_class(`ld-drop-${del}${z}`));
            return Gdk.DragAction.MOVE;
        }], ['leave', () => this._clearDropStyle()], ['drop', (_a, t, _x, y) => {
            this._clearDropStyle();
            if(t._group === this._group) this.emit('drop', y > this.get_allocation().height / 2);
        }]);
        this.add_controller(drop);
    }

    _clearDropStyle() {
        ['up', 'down', 'up-dark', 'down-dark'].forEach(x => this.remove_css_class(`ld-drop-${x}`));
    }

    _emit(s, v) {
        if(!this._syncing) this.emit(s, v);
    }

    binds(item) {
        this._syncing = true;
        this._item = item;
        this._txt.text = item.name;
        this._btn.active = item.enable;
        this._syncing = false;
    }
}

class SideBar extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                copy:   { param_types: [GObject.TYPE_INT] },
                remove: { param_types: [GObject.TYPE_INT] },
                select: { param_types: [GObject.TYPE_INT] },
                move:   { param_types: [GObject.TYPE_INT, GObject.TYPE_INT] },
                change: { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                add:    { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                enable: { param_types: [GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(cmds, swift) {
        super({ orientation: Gtk.Orientation.VERTICAL, sensitive: !!cmds.length });
        [this._buildExpander(cmds, swift), new Gtk.Separator(), this._buildTool()].forEach(x => this.append(x));
    }

    _buildExpander(cmds, swift) {
        // Ref: https://blog.gtk.org/2020/09/05/a-primer-on-gtklistview/
        this.swift = swift ? new Gtk.CheckButton() : null;
        this._model = new Gio.ListStore({ item_type: SideItem });
        cmds.forEach(x => this._model.append(new SideItem(x)));
        this._select = new Gtk.SingleSelection({ autoselect: false, model: this._model });
        this._select.connect('selection-changed', () => this.emit('select', this.selected));
        let factory = new Gtk.SignalListItemFactory();
        UI.conns(factory, ['setup', (_f, x) => {
            let row = new SideRow(this.swift);
            UI.conns(row, ['edit', (a, y) => this.edit(a, y)], ['toggle', (a, y) => this.toggle(a, y)],
                ['drag', a => { this.drag = this.getPos(a); }], ['drop', (a, down) => this.drop(this.getPos(a) + down)]);
            x.set_child(row);
        }], ['bind', (_f, x) => x.get_child().binds(x.get_item())]);
        this._list = new Gtk.ListView({ model: this._select, factory, vexpand: true });
        this._list.connect('activate', () => this.emit('select', this.selected));
        return new Gtk.ScrolledWindow({ child: this._list });
    }

    getPos(x) {
        return this._model.find(x._item).at(1);
    }

    toggle(a, enable) {
        if(this.swift && !enable) return;
        a._item.enable = enable;
        let pos = this.getPos(a);
        this.emit('enable', pos, enable);
        this.emit('select', pos);
    }

    edit(a, name) {
        a._item.name = name;
        this.emit('change', this.getPos(a), name);
    }

    drop(drop) {
        let to = drop > this.drag ? drop - 1 : drop;
        if(this.drag === to) return;
        let item = this._model.get_item(this.drag).copy();
        this._model.remove(this.drag);
        this._model.insert(to, item);
        this.emit('move', this.drag, to);
    }

    add(text = '{"name": "Name"}') {
        let index = this.selected;
        let item = new SideItem().from_string(text);
        if(this.swift) item.enable = false;
        if(index === Gtk.INVALID_LIST_POSITION) index = -1;
        this._model.insert(index + 1, item);
        this.emit('add', index, text);
    }

    _buildTool() {
        return new UI.Box(
            [['list-add-symbolic', _('Add'), () => {
                this.add();
            }], ['list-remove-symbolic', _('Remove'), () => {
                let index = this.selected;
                if(index === Gtk.INVALID_LIST_POSITION) return;
                this._model.remove(index);
                this.emit('remove', index);
            }], ['edit-copy-symbolic', _('Copy'), () => {
                this.emit('copy', this.selected);
            }], ['edit-paste-symbolic', _('Paste'), async () => {
                try {
                    this.add(await this.get_clipboard().read_text_async(null));
                } catch(e) {
                    this.get_root().add_toast(new Adw.Toast({ title: _('Paste content parsing failed'), timeout: 5 }));
                }
            }]].map(([icon_name, tooltip_text, y]) => {
                let btn = new Gtk.Button({ icon_name, tooltip_text, has_frame: false });
                btn.connect('clicked', y);
                return btn;
            }));
    }

    get selected() {
        return this._select.get_selected();
    }

    grabFocus(index) {
        this._select.set_selected(index);
        this.emit('select', this.selected);
    }

    setEnabled(index) {
        if(index >= 0 && index < this._model.n_items) this._model.get_item(index).enable = true;
        else if(this.swift) this.swift.active = true;
    }
}

class SwiftBox extends Adw.PreferencesPage {
    static {
        GObject.registerClass({
            Signals: {
                change: { param_types: [GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor() {
        super({ hexpand: true });
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '' };
        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._type    = new UI.Drop(['sh', 'JS']);
        this._command = new UI.LazyEntry('gio open LDWORD');
        this._regexp  = new UI.LazyEntry('(https?|ftp|file)://.*');
        this._commit  = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._copy    = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._popup   = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._select  = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._apps    = new AppsBox(_('Click the app icon to remove'), _('Allowlist'));
    }

    _buildUI() {
        let details = new Adw.PreferencesGroup();
        [
            [[_('Run command')], this._command],
            [[_('Command type')], this._type],
            [[_('Show result')], this._popup],
            [[_('Copy result')], this._copy],
            [[_('Select result')], this._select],
            [[_('Commit result')], this._commit],
            [[_('Application list')], this._apps],
            [[_('RegExp matcher')], this._regexp],
        ].forEach(xs => details.add(new UI.PrefRow(...xs)));
        this.add(details);
    }

    _bindValues() {
        this._type.connect('notify::selected', w => this._emit('type', w.get_selected()));
        this._popup.connect('state-set', (_w, state) => this._emit('popup', state));
        this._commit.connect('state-set', (_w, state) => this._emit('commit', state));
        this._select.connect('state-set', (_w, state) => this._emit('select', state));
        this._copy.connect('state-set', (_w, state) => this._emit('copy', state));
        this._apps.connect('changed', (_w, value) => this._emit('apps', value));
        this._regexp.connect('changed', w => this._emit('regexp', w.get_text()));
        this._command.connect('changed', w => this._emit('command', w.get_text()));
    }

    _emit(key, value) {
        if(this._syncing) return;
        this.emit('change', { [key]: value || undefined });
    }

    set config(config) {
        this._syncing = true;
        let temp = { ...this._temp, ...config };
        Object.keys(temp).forEach(x => {
            let prop = temp[x];
            let widget = this[`_${x}`];
            if(widget === undefined) return;
            switch(typeof prop) {
            case 'boolean': widget.set_state(prop); break;
            case 'number':  widget.set_selected(prop); break;
            case 'string': switch(x) {
            case 'apps': widget.value = prop; break;
            case 'icon': widget.value = prop; break;
            default: widget.set_text(prop); break;
            } break;
            }
        });
        this._syncing = false;
    }
}

class PopupBox extends SwiftBox {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '', tooltip: '', icon: '' };
    }

    _buildWidgets() {
        super._buildWidgets();
        this._icon = new UI.Icon();
        this._tooltip = new UI.LazyEntry('Open URL');
    }

    _buildUI() {
        let details = new Adw.PreferencesGroup();
        [
            [[_('Run command')], this._command],
            [[_('Command type')], this._type],
            [[_('Icon name')], this._icon],
            [[_('Show result')], this._popup],
            [[_('Copy result')], this._copy],
            [[_('Select result')], this._select],
            [[_('Commit result')], this._commit],
            [[_('Application list')], this._apps],
            [[_('RegExp matcher')], this._regexp],
            [[_('Icon tooltip')], this._tooltip],
        ].forEach(xs => details.add(new UI.PrefRow(...xs)));
        this.add(details);
    }

    _bindValues() {
        super._bindValues();
        this._icon.connect('changed', (_w, icon) => this._emit('icon', icon));
        this._tooltip.connect('changed', w => this._emit('tooltip', w.get_text()));
    }
}

class LightDictAbout extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params, gset) {
        super(params);
        let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30 });
        [this._buildIcon(gset), this._buildInfo(), this._buildTips(), new Gtk.Box({ vexpand: true }), this._buildLicense()].forEach(x => box.append(x));
        this._add(box);
    }

    _buildIcon(gset) {
        let box = new Gtk.Box({ halign: Gtk.Align.CENTER, margin_bottom: 30 }),
            active = gset.get_strv(Field.PCMDS).slice(0, gset.get_uint(Field.PGSZ)).flatMap(x => (y => y?.icon ? [y.icon] : [])(JSON.parse(x)));
        if(active.length) {
            active.forEach(x => {
                let icon = this._checkIcon(x);
                let img = new Gtk.Image({ icon_size: Gtk.IconSize.LARGE });
                icon ? img.set_from_icon_name(icon) : img.set_from_gicon(Gio.Icon.new_for_string(x));
                box.append(img);
            });
        } else { box.append(new Gtk.Image({ icon_size: Gtk.IconSize.LARGE, icon_name: 'accessories-dictionary-symbolic' })); }
        return box;
    }

    _checkIcon(path) {
        let name = GLib.basename(path).replace('.svg', '');
        return Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(name) ? name : '';
    }

    _buildInfo() {
        return this._buildLabel([
            `<b><big>${Me.metadata.name}</big></b>`,
            _('Version %d').format(Me.metadata.version),
            _('Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.'),
            `<span><a href="${Me.metadata.url}">${_GTK('Website')}\n</a></span>`,
        ].join('\n\n'));
    }

    _buildLabel(label) {
        return new Gtk.Label({ label, wrap: true, use_markup: true, justify: Gtk.Justification.CENTER });
    }

    _buildTips() {
        let box = new Gtk.Box({ spacing: 2, orientation: Gtk.Orientation.VERTICAL });
        [
            _('Leave RegExp/application list blank for no restriction'),
            _('Middle click the panel to copy the result to clipboard'),
            _('Substitute <b>LDWORD</b> for the selected text in the command'),
            _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
        ].forEach((x, i) => box.append(new Gtk.Label({ halign: Gtk.Align.START, use_markup: true, label: `${i}. ${x}` })));
        return new Gtk.MenuButton({
            label: _('Tips'),
            halign: Gtk.Align.CENTER,
            direction: Gtk.ArrowType.NONE,
            popover: new Gtk.Popover({ child: box }),
        });
    }

    _buildLicense() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html',
            license  = _GTK('GNU General Public License, version 3 or later'),
            statement = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';
        return this._buildLabel(`<small>\n\n${_GTK(statement).format(gpl, license)}</small>`);
    }
}

class LightDictBasic extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params, gset) {
        super(params);
        this._buildWidgets(gset);
        this._buildUI();
    }

    _buildWidgets(gset) {
        this._blk = UI.block({
            OCRP: ['text',     new UI.LazyEntry()],
            PGSZ: ['value',    new UI.Spin(1, 10, 1)],
            KEY:  ['active',   new Gtk.CheckButton()],
            ATHD: ['value',    new UI.Spin(500, 10000, 250)],
            LCMD: ['text',     new UI.LazyEntry('notify-send LDWORD')],
            RCMD: ['text',     new UI.LazyEntry('notify-send LDWORD')],
            TFLT: ['text',     new UI.LazyEntry('^[^\\n\\.\\t/,{3,50}$')],
            PSV:  ['selected', new UI.Drop([_('Proactive'), _('Passive')])],
            APP:  ['selected', new UI.Drop([_('Allowlist'), _('Blocklist')])],
            DOCR: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            TSTP: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            STRY: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            TIP:  ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            HDTT: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            APPS: ['value',    new AppsBox(_('Click the app icon to remove'))],
            TRG:  ['selected', new UI.Drop([_('Swift'), _('Popup'), _('Disable')])],
            OCRS: ['selected', new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line')])],
            OCR:  ['enable-expansion', new Adw.ExpanderRow({ title: _('OCR'), subtitle: _('Depends on python-opencv and python-pytesseract'), show_enable_switch: true })],
        }, gset);
        this._blk.KEYS = new UI.Keys(gset, Field.KEYS);
        this._blk.HELP = new Gtk.MenuButton({ label: _('Parameters'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER });
        this._buildHelpPopover().then(scc => this._blk.HELP.set_popover(scc)).catch(noop);
    }

    _buildUI() {
        [
            [[_('Enable systray')], this._blk.STRY],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this._blk.PSV, this._blk.TRG],
            [[_('Application list')], this._blk.APPS, this._blk.APP],
        ].forEach(xs => this._add(new UI.PrefRow(...xs)));
        [
            [this._blk.KEY, [_('Shortcut')], this._blk.KEYS],
            [[_('Dwell OCR')], this._blk.DOCR],
            [[_('Work mode')], this._blk.OCRS],
            [this._blk.HELP, [], this._blk.OCRP],
        ].forEach(xs => this._blk.OCR.add_row(new UI.PrefRow(...xs)));
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
        this._add(this._blk.OCR);
    }

    _buildExpander(title, ...list) {
        let expander = new Adw.ExpanderRow({ title });
        list.forEach(xs => expander.add_row(new UI.PrefRow(...xs)));
        return expander;
    }

    async _buildHelpPopover() {
        try {
            let label = await execute(`python ${Me.dir.get_child('ldocr.py').get_path()} -h`);
            return new Gtk.Popover({ child: new Gtk.Label({ label }) });
        } catch(e) {
            return new Gtk.Popover({ child: new Gtk.Label({ label: e.messaage }) });
        }
    }
}

class LightDictJSON extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params, gset, key) {
        super(params);
        this._key = key;
        this._gset = gset;
        this._swift = key === Field.SCMDS;
        this._cmds = this._gset.get_strv(key);
        this._buildWidgets();
        this._bindValues();
    }

    _buildWidgets() {
        let box = new Gtk.Box({ hexpand: true });
        let cmds = this._cmds.map(x => JSON.parse(x));
        if(this._swift) {
            this._enable = this.enable;
            if(cmds[this._enable]) cmds[this._enable].enable = true;
        }
        this._pane = this._swift ? new SwiftBox() : new PopupBox();
        this._side = new SideBar(cmds, this._swift);
        [this._side, new Gtk.Separator(), this._pane].forEach(x => box.append(x));
        this._add(new Gtk.Frame({ child: box }));
    }

    _bindValues() {
        UI.conns(this._side, ['add', this._onAdd.bind(this)], ['move', this._onMove.bind(this)],
            ['copy',   this._onCopy.bind(this)], ['enable', this._onEnable.bind(this)],
            ['select', this._onSelect.bind(this)], ['remove', this._onRemove.bind(this)],
            ['change', this._onSideChange.bind(this)]);
        this._pane.connect('change', this._onPaneChange.bind(this));
        if(this._swift) this._gset.connect(`changed::${Field.SCMD}`, () => this._onSettingChanged());
        this._side.grabFocus(0);
    }

    _onSettingChanged() {
        let index = this.enable;
        if(this._enable === index) return;
        this._side.setEnabled(index);
    }

    _onEnable(_w, index, enable) {
        if(this._swift) {
            this.enable = index;
        } else {
            this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), enable: enable || undefined }, null, 0);
            this._saveCommands();
        }
    }

    get enable() {
        return this._gset.get_int(Field.SCMD);
    }

    set enable(index) {
        if(!this._swift || this._enable === index) return;
        this._enable = index;
        this._gset.set_int(Field.SCMD, index);
    }

    _onSelect(_w, index) {
        this._pane.config = JSON.parse(this._cmds[index] || '{}');
    }

    _onSideChange(_w, index, name) {
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), name }, null, 0);
        this._saveCommands();
    }

    _onAdd(_w, index, text) {
        if(index < 0) {
            this._cmds.push(text);
            this._pane.set_sensitive(true);
        } else {
            this._cmds.splice(index + 1, 0, text);
            if(this._enable > index) this.enable = this._enable + 1;
        }
        this._side.grabFocus(index + 1);
        this._saveCommands();
    }

    _onRemove(_w, index) {
        this._cmds.splice(index, 1);
        if(this._enable >= index) this.enable = this._enable === index ? -1 : this._enable - 1;
        this._pane.config = JSON.parse(this._cmds[index] || this._cmds[index - 1] || '{}');
        if(this._cmds.length > 0 ^ this._pane.sensitive) this._pane.set_sensitive(this._cmds.length > 0);
        this._saveCommands();
    }

    _onMove(_w, f, t) {
        this._cmds.splice(t, 0, this._cmds.splice(f, 1).at(0));
        if(this._enable <= Math.max(f, t) && this._enable >= Math.min(f, t)) {
            if(this._enable > f) this.enable = this._enable - 1;
            else if(this._enable === f) this.enable = t;
            else this.enable = this._enable + 1;
        }
        this._side.grabFocus(t);
        this._saveCommands();
    }

    _onCopy(_w, index) {
        let text = this._cmds[index];
        if(!text) return;
        this.get_clipboard().set(text);
        this.get_root().add_toast(new Adw.Toast({ title: _('Content copied'), timeout: 5 }));
    }

    _onPaneChange(_w, prop) {
        let index = this._side.selected;
        if(!this._cmds[index]) return;
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), ...prop }, null, 0);
        this._saveCommands();
    }

    _saveCommands() {
        this._gset.set_strv(this._key, this._cmds);
    }
}
