// vim:fdm=syntax
// by tuberry
/* exported init fillPreferencesWindow */
'use strict';

const { Adw, Gtk, GObject, Gio, GLib, Gdk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = ExtensionUtils.gettext;
const _GTK = imports.gettext.domain('gtk40').gettext;
const { Fields } = Me.imports.fields;
const UI = Me.imports.ui;
const noop = () => {};
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function init() {
    ExtensionUtils.initTranslations();
}

function fillPreferencesWindow(win) {
    [
        new LightDictBasic({ title: _('Basic'), icon_name: 'face-smirk-symbolic' }),
        new LightDictJSON({ title: _('Swift'), icon_name: 'face-smile-big-symbolic' }, Fields.SCOMMANDS),
        new LightDictJSON({ title: _('Popup'), icon_name: 'face-devilish-symbolic' }, Fields.PCOMMANDS),
        new LightDictAbout({ title: _('About'), icon_name: 'face-surprise-symbolic' }),
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

class IconBtn extends UI.File {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({ filter: 'image/svg+xml' });
    }

    set_icon(icon) {
        this.file = icon;
    }

    get file() {
        return this._file ?? '';
    }

    _checkIcon(path) {
        let name = GLib.basename(path).replace('.svg', '');
        return Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(name) ? name : '';
    }

    set file(path) {
        let file = Gio.File.new_for_path(path);
        file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (src, res) => {
                let prev = this._file;
                try {
                    let info = src.query_info_finish(res);
                    this._setLabel(info.get_name().replace(RegExp(/(-symbolic)*.svg$/), ''));
                    let icon = this._checkIcon(path);
                    icon ? this._icon.set_from_icon_name(icon) : this._icon.set_from_gicon(Gio.Icon.new_for_string(path));
                    if(!this.file) this.chooser.set_file(file);
                    this._file = path;
                    this._icon.show();
                } catch(e) {
                    this._icon.hide();
                    this._setLabel(null);
                    this._file = null;
                } finally {
                    if(prev !== undefined && prev !== this.file) {
                        this.notify('file');
                        this.emit('changed', this.file);
                    }
                }
            });
    }
}

class AppsBox extends Gtk.Box {
    static {
        GObject.registerClass({
            Properties: {
                apps: genParam('string', 'apps', ''),
            },
            Signals: {
                changed:  { param_types: [GObject.TYPE_STRING] },
            },
        }, this);
    }

    constructor(tip1, tip2) {
        super({ valign: Gtk.Align.CENTER, hexpand: true, css_classes: ['linked'] });
        this._box = new Gtk.Box({ hexpand: true, tooltip_text: tip1 || '', css_name: 'entry', css_classes: ['linked'] });
        this._btn = new Gtk.Button({ tooltip_text: tip2 || '', icon_name: 'list-add-symbolic' });
        this._btn.connect('clicked', this._onAddActivated.bind(this));
        [this._box, this._btn].forEach(x => this.append(x));
    }

    vfunc_mnemonic_activate() {
        this._btn.activate();
    }

    set apps(apps) {
        if(!this.apps) {
            let widgets = [];
            let children = this._box.observe_children();
            for(let i = 0, x; (x = children.get_item(i)); i++) widgets.push(x);
            widgets.forEach(w => this._box.remove(w));
            apps.split(',').forEach(a => this._appendApp(a));
        }
        this._apps = apps;
        this.notify('apps');
    }

    get apps() {
        return this._apps ?? '';
    }

    get_apps() {
        return this.apps;
    }

    set_apps(apps) { // set new apps
        this._apps = '';
        this.apps = apps;
    }

    _onAddActivated(widget) {
        let chooser = new Gtk.AppChooserDialog({ modal: true, transient_for: widget.get_root() });
        let updateSensitivity = () => {
            let appInfo = chooser.get_widget().get_app_info();
            chooser.set_response_sensitive(Gtk.ResponseType.OK, appInfo && !this.apps.includes(appInfo.get_id()));
        };
        updateSensitivity();
        chooser.get_widget().set({ show_all: true, show_other: true });
        chooser.get_widget().connect('application-selected', updateSensitivity);
        chooser.connect('response', (wdg, res) => {
            if(res === Gtk.ResponseType.OK) {
                let id = wdg.get_widget().get_app_info().get_id();
                this._appendApp(id);
                this.apps = this.apps ? [this.apps, id].join(',') : id;
                this.emit('changed', this._apps);
            }
            chooser.destroy();
        });
        chooser.show();
    }

    _appendApp(id) {
        let appInfo = Gio.DesktopAppInfo.new(id);
        if(!appInfo) return;
        let app = new Gtk.Button({ tooltip_text: appInfo.get_display_name(), has_frame: false });
        app.set_child(new Gtk.Image({ gicon: appInfo.get_icon(), css_classes: ['icon-dropshadow'] }));
        app.connect('clicked', widget => {
            this._box.remove(widget);
            this.apps = this.apps.split(',').filter(x => x !== id).join(',');
            this.emit('changed', this._apps);
        });
        this._box.append(app);
    }
}

class SideBar extends Gtk.Box {
    // TODO: Gtk.ColumnView? - https://blog.gtk.org/2020/09/21/gtkcolumnview/
    static {
        GObject.registerClass({
            Signals: {
                selected: { param_types: [GObject.TYPE_INT] },
                clicked:  { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                changed:  { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                enabled:  { param_types: [GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(cmds, swift) {
        super({ orientation: Gtk.Orientation.VERTICAL, sensitive: !!cmds.length });
        this._swift = swift;
        [this._buildList(cmds), new Gtk.Separator(), this._buildTool()].forEach(x => this.append(x));
    }

    _buildList(cmds) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_BOOLEAN, GObject.TYPE_STRING]);
        cmds.forEach(x => model.set(model.append(), [0, 1], x));
        this._list = new Gtk.TreeView({ model, headers_visible: false, vexpand: true });
        this._list.get_selection().connect('changed', this._onSelectChanged.bind(this));
        [[new Gtk.CellRendererToggle({ radio: this._swift }), 'active', 'toggled', this._onEnableToggled.bind(this)],
            [new Gtk.CellRendererText({ editable: true }), 'text', 'edited', this._onNameChanged.bind(this)]]
            .forEach((x, i) => this._list.append_column(this._column(i, ...x)));

        return this._list;
    }

    _column(index, widget, key, signal, func) {
        let column = new Gtk.TreeViewColumn();
        column.pack_start(widget, true);
        column.add_attribute(widget, key, index);
        widget.connect(signal, func);
        return column;
    }

    _buildTool() {
        let box = new Gtk.Box({ css_classes: ['linked'] });
        ['list-add', 'list-remove', 'go-down', 'go-up'].map(x => {
            let btn = new Gtk.Button({ icon_name: `${x}-symbolic`, has_frame: false });
            btn.connect('clicked', () => this._onButtonClicked(x));
            return btn;
        }).forEach(x => box.append(x));

        return box;
    }

    _onButtonClicked(btn) {
        let [ok, model, iter] = this._list.get_selection().get_selected();
        if(!ok) {
            if(btn !== 'list-add') return;
            model.set(model.insert(0), [0, 1], [false, 'name']);
            this.emit('clicked', -1, btn);
            return;
        }
        let [index] = model.get_path(iter).get_indices();
        switch(btn) {
        case 'go-up':
        case 'go-down': {
            let tmp = iter.copy();
            if(btn === 'go-up' ? !model.iter_previous(iter) : !model.iter_next(iter)) return;
            model.swap(tmp, iter);
            break;
        }
        case 'list-add':
            model.set(model.insert(index + 1), [0, 1], [false, 'name']);
            break;
        case 'list-remove':
            model.remove(iter);
            break;
        }
        this.emit('clicked', index, btn);
    }

    _onSelectChanged() {
        this.emit('selected', this.selected);
    }

    get selected() {
        let [ok, model, iter] = this._list.get_selection().get_selected();
        return ok ? model.get_path(iter).get_indices()[0] : -1;
    }

    _onEnableToggled(widget, path) {
        let active = widget.get_active();
        let [ok_, iter] = this._list.model.get_iter_from_string(path);
        let [index] = this._list.model.get_path(iter).get_indices();
        this.emit('enabled', index, !active);
        if(this._swift) this._disableAll();
        this._list.model.set(iter, [0], [!active]);
    }

    _onNameChanged(widget, path, text) {
        let name = text || 'name';
        let [ok_, iter] = this._list.model.get_iter_from_string(path);
        let [index] = this._list.model.get_path(iter).get_indices();
        this.emit('changed', index, name);
        this._list.model.set(iter, [1], [name]);
    }

    _disableAll() {
        let [ok, iter] = this._list.model.get_iter_first();
        if(!ok) return;
        do this._list.model.set(iter, [0], [false]);
        while(this._list.model.iter_next(iter));
    }

    _grabFocus() {
        let [ok, iter] = this._list.model.get_iter_first();
        if(!ok) return;
        this._list.set_cursor(this._list.model.get_path(iter), null, false);
    }

    _grabFocusNext() {
        let [ok, model, iter] = this._list.get_selection().get_selected();
        if(!ok) return;
        this._list.model.iter_next(iter);
        this._list.set_cursor(model.get_path(iter), null, false);
    }
}

class SwiftBox extends Adw.PreferencesPage {
    static {
        GObject.registerClass({
            Signals: {
                changed:  { param_types: [GObject.TYPE_JSOBJECT] },
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
        this._type    = new UI.Drop('sh', 'JS');
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
        this._popup.connect('state-set', (widget, state) => this._emitChanged({ popup: state || undefined }));
        this._commit.connect('state-set', (widget, state) => this._emitChanged({ commit: state || undefined }));
        this._select.connect('state-set', (widget, state) => this._emitChanged({ select: state || undefined }));
        this._copy.connect('state-set', (widget, state) => this._emitChanged({ copy: state || undefined }));
        this._apps.connect('changed', widget => this._emitChanged({ apps: widget.get_apps() || undefined }));
        this._type.connect('notify::selected', widget => this._emitChanged({ type: widget.get_selected() || undefined }));
        this._regexp.connect('changed', widget => this._emitChanged({ regexp: widget.get_text() || undefined }));
        this._command.connect('changed', widget => this._emitChanged({ command: widget.get_text() || undefined }));
    }

    _emitChanged(param) {
        if(this._blocked) return;
        log(JSON.stringify(param));
        this.emit('changed', param);
    }

    set config(config) {
        this._blocked = true;
        let temp = { ...this._temp, ...config };
        Object.keys(temp).forEach(x => {
            let prop = temp[x];
            let widget = this[`_${x}`];
            if(widget === undefined) return;
            switch(typeof prop) {
            case 'boolean': widget.set_state(prop); break;
            case 'number':  widget.set_selected(prop); break;
            case 'string': switch(x) {
            case 'apps': widget.set_apps(prop); break;
            case 'icon': widget.set_icon(prop); break;
            default: widget.set_text(prop); break;
            } break;
            }
        });
        this._blocked = false;
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
        this._icon = new IconBtn();
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
        this._icon.connect('changed', (widget, icon) => this._emitChanged({ icon: icon || undefined }));
        this._tooltip.connect('changed', widget => this._emitChanged({ tooltip: widget.get_text() || undefined }));
    }
}

class LightDictAbout extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30 });
        [this._buildIcon(), this._buildInfo(), this._buildTips(), new Gtk.Box({ vexpand: true }), this._buildLicense()].forEach(x => box.append(x));
        this._add(box);
    }

    _buildIcon() {
        let box = new Gtk.Box({ halign: Gtk.Align.CENTER, margin_bottom: 30 });
        let active = gsettings.get_strv(Fields.PCOMMANDS).slice(0, gsettings.get_uint(Fields.PAGESIZE)).flatMap(x => (y => y?.icon ? [y.icon] : [])(JSON.parse(x)));
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
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html';
        let license  = _GTK('GNU General Public License, version 3 or later');
        let statement = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';

        return this._buildLabel(`<small>\n\n${_GTK(statement).format(gpl, license)}</small>`);
    }
}

class LightDictBasic extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_ocr_params     = new UI.LazyEntry();
        this._field_page_size      = new UI.Spin(1, 10, 1);
        this._field_short_ocr      = new Gtk.CheckButton();
        this._field_auto_hide      = new UI.Spin(500, 10000, 250);
        this._field_left_command   = new UI.LazyEntry('notify-send LDWORD');
        this._field_right_command  = new UI.LazyEntry('notify-send LDWORD');
        this._field_text_filter    = new UI.LazyEntry('^[^\\n\\.\\t/:]{3,50}$');
        this._field_passive_mode   = new UI.Drop(_('Proactive'), _('Passive'));
        this._field_list_type      = new UI.Drop(_('Allowlist'), _('Blocklist'));
        this._field_ocr_shortcut   = new UI.Short(gsettings, Fields.OCRSHORTCUT);
        this._field_dwell_ocr      = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_enable_ocr     = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_enable_strip   = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_enable_systray = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_enable_tooltip = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_hide_title     = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._field_app_list       = new AppsBox(_('Click the app icon to remove'));
        this._field_trigger_style  = new UI.Drop(_('Swift'), _('Popup'), _('Disable'));
        this._field_ocr_work_mode  = new UI.Drop(_('Word'), _('Paragraph'), _('Area'), _('Line'));
        this._ocr_help_button      = new Gtk.MenuButton({ label: _('Help'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER });
        this._field_enable_ocr     = new Adw.ExpanderRow({ title: _('OCR'), subtitle: _('Depends on python-opencv and python-pytesseract'), show_enable_switch: true });
    }

    _buildUI() {
        [
            [[_('Enable systray')], this._field_enable_systray],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this._field_passive_mode, this._field_trigger_style],
            [[_('Application list')], this._field_app_list, this._field_list_type],
        ].forEach(xs => this._add(new UI.PrefRow(...xs)));
        [
            [this._field_short_ocr, [_('Shortcut')], this._field_ocr_shortcut],
            [[_('Dwell OCR')], this._field_dwell_ocr],
            [[_('Work mode')], this._field_ocr_work_mode],
            [[_('Parameters')], this._field_ocr_params, this._ocr_help_button],
        ].forEach(xs => this._field_enable_ocr.add_row(new UI.PrefRow(...xs)));
        [this._buildList(_('Other'),
            [[_('Trim blank lines')], this._field_enable_strip],
            [[_('Autohide interval')], this._field_auto_hide],
            [[_('RegExp filter')], this._field_text_filter]),
        this._buildList(_('Panel'),
            [[_('Hide title')], this._field_hide_title],
            [[_('Right command'), _('Right click to run and hide panel')], this._field_right_command],
            [[_('Left command'), _('Left click to run')], this._field_left_command]),
        this._buildList(_('Popup'),
            [[_('Enable tooltip')], this._field_enable_tooltip],
            [[_('Page size')], this._field_page_size])].forEach(x => this._add(x));
        this._add(this._field_enable_ocr);
    }

    _buildList(title, ...list) {
        let expander = new Adw.ExpanderRow({ title });
        list.forEach(xs => expander.add_row(new UI.PrefRow(...xs)));
        return expander;
    }

    _bindValues() {
        [
            [Fields.TXTFILTER, this._field_text_filter,    'text'],
            [Fields.RCOMMAND,  this._field_right_command,  'text'],
            [Fields.LCOMMAND,  this._field_left_command,   'text'],
            [Fields.OCRPARAMS, this._field_ocr_params,     'text'],
            [Fields.APPLIST,   this._field_app_list,       'apps'],
            [Fields.AUTOHIDE,  this._field_auto_hide,      'value'],
            [Fields.PAGESIZE,  this._field_page_size,      'value'],
            [Fields.TRIGGER,   this._field_trigger_style,  'selected'],
            [Fields.OCRMODE,   this._field_ocr_work_mode,  'selected'],
            [Fields.LISTTYPE,  this._field_list_type,      'selected'],
            [Fields.SYSTRAY,   this._field_enable_systray, 'active'],
            [Fields.ENABLEOCR, this._field_enable_ocr,     'enable-expansion'],
            [Fields.DWELLOCR,  this._field_dwell_ocr,      'active'],
            [Fields.SHORTOCR,  this._field_short_ocr,      'active'],
            [Fields.HIDETITLE, this._field_hide_title,     'active'],
            [Fields.TEXTSTRIP, this._field_enable_strip,   'active'],
            [Fields.TOOLTIP,   this._field_enable_tooltip, 'active'],
            [Fields.PASSIVE,   this._field_passive_mode,   'selected'],
        ].forEach(xs => gsettings.bind(...xs, Gio.SettingsBindFlags.DEFAULT));
        this._buildHelpPopver().then(scc => this._ocr_help_button.set_popover(scc)).catch(noop);
    }

    async _buildHelpPopver() {
        let proc = new Gio.Subprocess({
            argv: ['python', Me.dir.get_child('ldocr.py').get_path(), '-h'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        let label = proc.get_successful() ? stdout : stderr;
        return new Gtk.Popover({ child: new Gtk.Label({ label: label.trim() }) });
    }
}

class LightDictJSON extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params, key) {
        super(params);
        this._key = key;
        this._swift = key === Fields.SCOMMANDS;
        this._cmds = gsettings.get_strv(key);
        this._buildWidgets();
        this._bindValues();
    }

    _buildWidgets() {
        let box = new Gtk.Box({ hexpand: true });
        if(this._swift) {
            this._pane = new SwiftBox();
            let index = this.enabled;
            this._side = new SideBar(this._cmds.map((x, i) => [i === index, JSON.parse(x).name]), true);
        } else {
            this._pane = new PopupBox();
            this._side = new SideBar(this._cmds.map(x => (c => [!!c.enable, c.name])(JSON.parse(x))), false);
        }
        [this._side, new Gtk.Separator(), this._pane].forEach(x => box.append(x));
        let frame = new Gtk.Frame({ child: box });
        this._add(frame);
    }

    _bindValues() {
        this._side.connect('selected', this._onSelectChanged.bind(this));
        this._side.connect('clicked', this._onButtonClicked.bind(this));
        this._side.connect('changed', this._onNameChanged.bind(this));
        this._side.connect('enabled', this._onEnableToggled.bind(this));
        this._pane.connect('changed', this._onValueChanged.bind(this));
        this._side._grabFocus();
    }

    _onSelectChanged(widget, index) {
        this._pane.config = JSON.parse(this._cmds[index] || '{}');
    }

    _onNameChanged(widget, index, name) {
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), name }, null, 0);
        this._saveCommands();
    }

    get enabled() {
        return gsettings.get_int(Fields.SCOMMAND);
    }

    _onButtonClicked(widget, index, button) {
        let enable = this.enabled, moved = null;
        switch(button) {
        case 'go-up':
        case 'go-down': {
            let swap = button === 'go-up' ? index - 1 : index + 1;
            [this._cmds[index], this._cmds[swap]] = [this._cmds[swap], this._cmds[index]];
            if(enable === swap || enable === index) moved = enable === index ? swap : index;
            break;
        }
        case 'list-remove':
            this._cmds.splice(index, 1);
            if(enable >= index) moved = enable === index ? -1 : enable - 1;
            this._pane.config = JSON.parse(this._cmds[index] || this._cmds[index - 1] || '{}');
            if(this._cmds.length > 0 ^ this._pane.sensitive) this._pane.set_sensitive(this._cmds.length > 0);
            break;
        case 'list-add':
            if(index < 0) {
                this._cmds.push('{"name":"name"}');
                this._pane.set_sensitive(true);
                this._side._grabFocus();
            } else {
                this._cmds.splice(index + 1, 0, '{"name":"name"}');
                if(enable > index) moved = enable + 1;
                this._side._grabFocusNext();
            }
            break;
        }
        this._saveCommands();
        if(moved !== null) this._saveCommand(moved);
    }

    _onEnableToggled(widget, index, enable) {
        if(this._swift) {
            if(enable && this._cmds[index]) this._saveCommand(index);
        } else {
            this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), enable: enable || undefined }, null, 0);
            this._saveCommands();
        }
    }

    _onValueChanged(widget, prop) {
        let index = this._side.selected;
        log(index);
        if(!this._cmds[index]) return;
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), ...prop }, null, 0);
        this._saveCommands();
    }

    _saveCommand(index) {
        if(this._swift) gsettings.set_int(Fields.SCOMMAND, index);
    }

    _saveCommands() {
        gsettings.set_strv(this._key, this._cmds);
    }
}

