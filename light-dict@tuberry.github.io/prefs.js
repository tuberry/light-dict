// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Clutter, GLib, Gtk, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const _GTK = imports.gettext.domain('gtk40').gettext;
const Fields = Me.imports.fields.Fields;
const UI = Me.imports.ui;

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    return new LightDictPrefs();
}

const LightDictPrefs = GObject.registerClass(
class LightDictPrefs extends Gtk.Stack {
    _init() {
        super._init({ transition_type: Gtk.StackTransitionType.NONE, });

        this._add_tab(new LightDictBasic(), 'basic', _('Basic'));
        this._add_tab(new LightDictJSON(Fields.SCOMMANDS), 'swift', _('Swift'));
        this._add_tab(new LightDictJSON(Fields.PCOMMANDS), 'popup', _('Popup'));
        this._add_tab(new LightDictAbout(), 'about', _('About'));

        this.connect('realize', () => {
            this.get_root().get_titlebar().set_title_widget(new Gtk.StackSwitcher({ halign: Gtk.Align.CENTER, stack: this }));
            this.get_root().set_default_size(650, 560);
        });
    }

    _add_tab(tab, name, title) {
        this.add_titled(new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, child: tab, }), name, title);
    }
});

const CenterLabel = GObject.registerClass(
class CenterLabel extends Gtk.Label {
    _init(label) {
        super._init({
            wrap: true,
            label: label,
            use_markup: true,
            justify: Gtk.Justification.CENTER,
        });
    }
});

const AppsBox = GObject.registerClass({
    Properties: {
        'apps': GObject.param_spec_string('apps', 'apps', 'apps', '', GObject.ParamFlags.READWRITE),
    },
    Signals: {
        'changed':  { param_types: [GObject.TYPE_STRING] },
    },
}, class AppsBox extends UI.Box {
    _init(tip1, tip2) {
        super._init();

        this._box = new Gtk.Box({ hexpand: true, tooltip_text: tip1 || '' });
        this.appendS([this._box, this._addBtnMaker(tip2)])
    }

    vfunc_snapshot(snapshot) {
        //CREDIT: https://discourse.gnome.org/t/how-to-reuse-an-existing-gtk-widgets-style-class-in-a-custom-widget/5969/9?u=tuberry
        snapshot.render_background(new Gtk.Entry().get_style_context(), 0, 0, this.get_width(), this.get_height());
        super.vfunc_snapshot(snapshot);
    }

    set apps(apps) {
        if(!this.apps) {
            let widgets = [];
            let children = this._box.observe_children();
            for(let i = 0, x; !!(x = children.get_item(i)); i++) widgets.push(x);
            widgets.forEach(w => { this._box.remove(w); });
            apps.split(',').forEach(a => { this._appendApp(a); });
        }
        this._apps = apps;
        this.notify('apps');
    }

    get apps() {
        return this?._apps ?? '';
    }

    get_apps() {
        return this.apps;
    }

    set_apps(apps) { // set new apps
        this._apps = '';
        this.apps = apps;
    }

    _onAddActivated(widget) {
        let chooser = new Gtk.AppChooserDialog({ modal: true, transient_for: widget.get_root(), });
        let updateSensitivity = () => {
            let appInfo = chooser.get_widget().get_app_info();
            chooser.set_response_sensitive(Gtk.ResponseType.OK, appInfo && !this.apps.includes(appInfo.get_id()));
        };
        updateSensitivity();
        chooser.get_widget().set({ show_all: true, show_other: true, });
        chooser.get_widget().connect('application-selected', updateSensitivity);
        chooser.connect('response', (widget, response) => {
            if(response == Gtk.ResponseType.OK) {
                let id = widget.get_widget().get_app_info().get_id();
                this._appendApp(id);
                this.apps = this.apps ? [this.apps, id].join(',') : id;
                this.emit('changed', this._apps);
            }
            chooser.destroy();
        });
        chooser.show();
    }

    _addBtnMaker(tips) {
        let add = new Gtk.Button({ tooltip_text: tips || '', has_frame: false, });
        add.set_child(new Gtk.Image({ icon_name: 'list-add-symbolic' }));
        add.connect('clicked', this._onAddActivated.bind(this));

        return add;
    }

    _appendApp(id) {
        let appInfo = Gio.DesktopAppInfo.new(id);
        if(!appInfo) return;

        let app = new Gtk.Button({ tooltip_text: appInfo.get_display_name(), has_frame: false, });
        app.set_child(new Gtk.Image({ gicon: appInfo.get_icon() }));
        app.connect('clicked', widget => {
            this._box.remove(widget);
            this.apps = this.apps.split(',').filter(x => x !== id).join(',');
            this.emit('changed', this._apps);
        });
        this._box.append(app);
    }
});

const SideBar = GObject.registerClass({
    Signals: {
        'selected': { param_types: [GObject.TYPE_INT] },
        'clicked':  { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
        'changed':  { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
        'enabled':  { param_types: [GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
    },
}, class SideBar extends UI.Box {
    _init(cmds, swift) {
        super._init({ vertical: true });
        this._swift = swift;
        this.appendS([this._buildList(cmds), this._buildTool()]);
    }

    _buildList(cmds) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_BOOLEAN, GObject.TYPE_STRING]);
        cmds.forEach(x => { model.set(model.append(), [0, 1], x); });
        this._list = new Gtk.TreeView({ model: model, headers_visible: false, vexpand: true });
        this._list.get_selection().connect('changed', this._onSelectChanged.bind(this));

        let enable = new Gtk.CellRendererToggle({ radio: this._swift }); // type
        let status = new Gtk.TreeViewColumn();
        status.pack_start(enable, true);
        status.add_attribute(enable, 'active', 0);
        enable.connect('toggled', this._onEnableToggled.bind(this));
        this._list.append_column(status);

        let text = new Gtk.CellRendererText({ editable: true });
        let name = new Gtk.TreeViewColumn();
        name.pack_start(text, true);
        name.add_attribute(text, 'text', 1);
        text.connect('edited', this._onNameChanged.bind(this));
        this._list.append_column(name);

        return this._list;
    }

    _buildTool() {
        this._tool = new UI.Box({ spacing: 2, }).appends(['list-add', 'list-remove', 'go-down', 'go-up'].map(x => {
            let btn = new Gtk.Button({ icon_name: x + '-symbolic', has_frame: false });
            btn.connect('clicked', () => { this._onButtonClicked(x); });
            return btn;
        }));

        return this._tool;
    }

    _onButtonClicked(btn) {
        let [ok, model, iter] = this._list.get_selection().get_selected();
        if(!ok) {
            if(btn != 'list-add') return;
            model.set(model.insert(0), [0, 1], [false, 'name']);
            this.emit('clicked', -1, btn);
            return;
        }
        let [index] = model.get_path(iter).get_indices();
        switch(btn) {
        case 'go-up':
        case 'go-down':
            let tmp = iter.copy();
            if(btn == 'go-up' ? !model.iter_previous(iter) : !model.iter_next(iter)) return;
            model.swap(tmp, iter);
            break;
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
        return ok ? model.get_path(iter).get_indices()[0] : -1
    }

    _onEnableToggled(widget, path) {
        let active = widget.get_active();
        let [ok, iter] = this._list.model.get_iter_from_string(path);
        let [index] = this._list.model.get_path(iter).get_indices();
        this.emit('enabled', index, !active);
        if(this._swift) this._disableAll();
        this._list.model.set(iter, [0], [!active]);
    }

    _onNameChanged(widget, path, text) {
        let name = text ? text : 'name';
        let [ok, iter] = this._list.model.get_iter_from_string(path);
        let [index] = this._list.model.get_path(iter).get_indices();
        this.emit('changed', index, name);
        this._list.model.set(iter, [1], [name]);
    }

    _disableAll() {
        let [ok, iter] = this._list.model.get_iter_first();
        if(!ok) return;
        do {
            this._list.model.set(iter, [0], [false]);
        } while(this._list.model.iter_next(iter));
    }
});

const SwiftBox = GObject.registerClass({
    Signals: {
        'changed':  { param_types: [GObject.TYPE_JSOBJECT] },
    },
}, class SwiftBox extends UI.Box {
    _init() {
        super._init({ vertical: true });
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '' };

        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._popup   = new Gtk.Switch();
        this._commit  = new Gtk.Switch();
        this._copy    = new Gtk.Switch();
        this._select  = new Gtk.Switch();
        this._type    = new UI.Combo(['sh', 'JS']);
        this._command = new UI.Entry('gio open LDWORD');
        this._regexp  = new UI.Entry('(https?|ftp|file)://.*');
        this._apps    = new AppsBox(_('Click the app icon to remove'), _('Allowlist'));
    }

    _buildUI() {
        let details = new UI.ListGrid();
        details._att(new UI.Label(_('Run command'), true), this._command);
        details._add(new UI.Label(_('Command type')), this._type);
        details._add(new UI.Label(_('Show result')), this._popup);
        details._add(new UI.Label(_('Copy result')), this._copy);
        details._add(new UI.Label(_('Select result')), this._select);
        details._add(new UI.Label(_('Commit result')), this._commit);

        let addition = new UI.ListGrid();
        addition._att(new UI.Label(_('Application list'), true), this._apps);
        addition._att(new UI.Label(_('RegExp matcher'), true), this._regexp);
        let info = new UI.ListGrid();
        info._att(new UI.Label(_('Only one item can be enabled in swift style.\n') +
                               _('The first one will be used by default if none is enabled.\n') +
                               _('Double click a list item on the left to change the name.')));

        this.appendS([details, addition, info]);
    }

    _bindValues() {
        this._popup.connect('state-set', (widget, state) => { this._emitChanged({ popup: state }) });
        this._commit.connect('state-set', (widget, state) => { this._emitChanged({ commit: state }) });
        this._select.connect('state-set', (widget, state) => { this._emitChanged({ select: state }); });
        this._copy.connect('state-set', (widget, state) => { this._emitChanged({ copy: state }); });
        this._apps.connect('changed', widget => { this._emitChanged({ apps: widget.get_apps() }); });
        this._type.connect('changed', widget => { this._emitChanged({ type: widget.get_active() }); });
        this._regexp.connect('changed', widget => { this._emitChanged({ regexp: widget.get_text() }); });
        this._command.connect('changed', widget => { this._emitChanged({ command: widget.get_text() }); });
    }

    _emitChanged(prama) {
        if(this._blocked) return;
        this.emit('changed', prama)
    }

    set config(config) {
        this._blocked = true;
        let temp = JSON.parse(JSON.stringify(this._temp));
        Object.assign(temp, config);
        Object.keys(temp).forEach(x => {
            let prop = temp[x];
            let widget = this['_' + x];
            if(widget === undefined) return;
            switch(typeof prop) {
            case 'boolean': widget.set_state(prop); break;
            case 'number':  widget.set_active(prop); break;
            case 'string':  x == 'apps' ? widget.set_apps(prop) : widget._set_text(prop); break;
            }
        });
        this._blocked = false;
    }
});

const PopupBox = GObject.registerClass(
class PopupBox extends SwiftBox {
    _init() {
        super._init();
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '', tooltip: '', icon: '' };
    }

    _buildWidgets() {
        super._buildWidgets();
        this._tooltip = new UI.Entry('Open URL with gio open');
        this._icon    = new UI.Entry('face-cool-symbolic', '', true);
    }

    _buildUI() {
        let details = new UI.ListGrid();
        details._att(new UI.Label(_('Run command'), true), this._command);
        details._add(new UI.Label(_('Icon name')), this._icon);
        details._add(new UI.Label(_('Command type')), this._type);
        details._add(new UI.Label(_('Show result')), this._popup);
        details._add(new UI.Label(_('Copy result')), this._copy);
        details._add(new UI.Label(_('Select result')), this._select);
        details._add(new UI.Label(_('Commit result')), this._commit);

        let addition = new UI.ListGrid();
        addition._att(new UI.Label(_('Application list'), true), this._apps);
        addition._att(new UI.Label(_('RegExp matcher'), true), this._regexp);
        addition._att(new UI.Label(_('Icon tooltip'), true), this._tooltip);
        this.appendS([details, addition]);
    }

    _bindValues() {
        super._bindValues();
        this._icon.connect('changed', widget => { this._emitChanged({ icon: widget.get_text() }); });
        this._tooltip.connect('changed', widget => { this._emitChanged({ tooltip: widget.get_text() }); });
    }
});

const LightDictAbout = GObject.registerClass(
class LightDictAbout extends UI.Box {
    _init() {
        super._init({ vertical: true, margins: [30] });
        this.appends([this._buildIcon(), this._buildInfo(), this._buildTips(), new Gtk.Box({ vexpand: true }), this._buildLicense()]);
    }

    _buildIcon() {
        let box = new UI.Box({ margins: [0, 0, 30] });
        box.set_halign(Gtk.Align.CENTER);
        let active = gsettings.get_strv(Fields.PCOMMANDS).slice(0, gsettings.get_uint(Fields.PAGESIZE));
        if(active.length) {
            box.appends(active.map(x => new Gtk.Image({ icon_size: Gtk.IconSize.LARGE, icon_name: JSON.parse(x)?.icon ?? 'help-symbolic', })));
        } else {
            box.append(new Gtk.Image({ icon_size: Gtk.IconSize.LARGE, icon_name: 'accessories-dictionary-symbolic', }));
        }

        return box;
    }

    _buildInfo() {
        let info = [
            '<b><big>%s</big></b>'.format(Me.metadata.name),
            _('Version %d').format(Me.metadata.version),
            _('Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.'),
            '<span><a href="' + Me.metadata.url + '">' + _GTK('Website') + '\n</a></span>',
        ];

        return new CenterLabel(info.join('\n\n'));
    }

    _buildTips() {
        let tips = new UI.Box({ vertical: true, margins: [5], spacing: 2 }).appends([
            _('Leave RegExp/application list blank for no restriction'),
            _('Middle click the panel to copy the result to clipboard'),
            _('Substitute <b>LDWORD</b> for the selected text in the command'),
            _('Add the icon to <i>~/.local/share/icons/hicolor/symbolic/apps/</i>'),
            _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
            _('Hold <b>Alt/Shift</b> to function when highlighting in <b>Passive mode</b>'),
        ].map((msg, i) => new Gtk.Label({ halign: Gtk.Align.START , use_markup: true, label: i + '. ' + msg })));

        return new Gtk.MenuButton({
            label: _('Tips'),
            halign: Gtk.Align.CENTER,
            direction: Gtk.ArrowType.NONE,
            popover: new Gtk.Popover({ child: tips }),
        });
    }

    _buildLicense() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html';
        let license  = _GTK('GNU General Public License, version 3 or later');
        let statement = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.'

        return new CenterLabel('<small>\n\n' + _GTK(statement).format(gpl, license) + '</small>');
    }
});

const LightDictBasic = GObject.registerClass(
class LightDictBasic extends UI.Box {
    _init() {
        super._init({ vertical: true, margins: [0, 40], });

        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_enable_strip   = new Gtk.Switch();
        this._field_enable_systray = new Gtk.Switch();
        this._field_enable_tooltip = new Gtk.Switch();
        this._field_hide_title     = new Gtk.Switch();
        this._field_page_size      = new UI.Spin(1, 10, 1);
        this._field_auto_hide      = new UI.Spin(500, 10000, 250);
        this._field_enable_ocr     = new UI.Check(_('Enable OCR'));
        this._field_text_filter    = new UI.Entry('^[^\\n\\.\\t/:]{3,50}$');
        this._field_app_list       = new AppsBox(_('Click the app icon to remove'));
        this._field_list_type      = new UI.Combo([_('Allowlist'), _('Blocklist')]);
        this._field_trigger_style  = new UI.Combo([_('Swift'), _('Popup'), _('Disable')]);
        this._field_left_command   = new UI.Entry('notify-send LDWORD', _('Left click to run'));
        this._field_ocr_shortcut   = new UI.Shortcut(gsettings.get_strv(Fields.OCRSHORTCUT), _('Shortcut'));
        this._ocr_help_button      = new Gtk.MenuButton({ label: _('Parameters'), direction: Gtk.ArrowType.NONE, });
        this._field_passive_mode   = new UI.Combo([_('Proactive'), _('Passive')], _('Need modifier to trigger or not'));
        this._field_ocr_work_mode  = new UI.Combo([_('Word'), _('Paragraph'), _('Area'), _('Selection'), _('Line'), _('Button')]);
        this._field_right_command  = new UI.Entry('gio open https://www.google.com/search?q=LDWORD', _('Right click to run and hide panel'));
        this._field_ocr_params     = new UI.Entry('-d zh-cn', _('Depends on python-opencv, python-pytesseract and python-googletrans (optional)'));
    }

    _buildUI() {
        let common = new UI.ListGrid();
        common._add(new UI.Label(_('Enable systray')), this._field_enable_systray);
        common._add(new UI.Label(_('Trim blank lines')), this._field_enable_strip);
        common._add(new UI.Label(_('Autohide interval')), this._field_auto_hide);
        common._add(new UI.Label(_('Trigger style')), this._field_passive_mode, this._field_trigger_style);
        common._att(new UI.Label(_('Application list'), true), this._field_app_list, this._field_list_type);
        common._att(new UI.Label(_('RegExp filter'), true), this._field_text_filter);
        let panel = new UI.ListGrid();
        panel._add(new UI.Label(_('Hide title')), this._field_hide_title);
        panel._att(new UI.Label(_('Right command'), true), this._field_right_command);
        panel._att(new UI.Label(_('Left command'), true), this._field_left_command);
        let popup = new UI.ListGrid();
        popup._add(new UI.Label(_('Enable tooltip')), this._field_enable_tooltip);
        popup._add(new UI.Label(_('Page size')), this._field_page_size);
        let ocr = new UI.ListGrid();
        ocr._add(this._field_enable_ocr, this._field_ocr_shortcut);
        ocr._add(new UI.Label(_('Work mode')), this._field_ocr_work_mode);
        ocr._att(this._ocr_help_button, this._field_ocr_params);

        this.appends([new UI.Frame(common, _('Common'), true), new UI.Frame(panel, _('Panel'), true), new UI.Frame(popup, _('Popup'), true), new UI.Frame(ocr, _('OCR'))]);
    }

    _bindValues() {
        gsettings.bind(Fields.TXTFILTER, this._field_text_filter,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.RCOMMAND,  this._field_right_command,  'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LCOMMAND,  this._field_left_command,   'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OCRPARAMS, this._field_ocr_params,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.APPLIST,   this._field_app_list,       'apps',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,  this._field_auto_hide,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,  this._field_page_size,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,   this._field_trigger_style,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OCRMODE,   this._field_ocr_work_mode,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LISTTYPE,  this._field_list_type,      'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SYSTRAY,   this._field_enable_systray, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEOCR, this._field_enable_ocr,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE, this._field_hide_title,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP, this._field_enable_strip,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIP,   this._field_enable_tooltip, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PASSIVE,   this._field_passive_mode,   'active', Gio.SettingsBindFlags.DEFAULT);

        this._bindOCRHelpMessage();
        this._field_left_command._set_edit();
        this._field_right_command._set_edit();
        this._field_text_filter._set_edit();
        this._field_ocr_params._set_edit();
        this._field_enable_ocr.bind_property('active', this._field_ocr_params, 'sensitive', GObject.BindingFlags.GET);
        this._field_enable_ocr.bind_property('active', this._field_ocr_work_mode, 'sensitive', GObject.BindingFlags.GET);
        this._field_ocr_params.set_sensitive(this._field_enable_ocr.active);
        this._field_ocr_work_mode.set_sensitive(this._field_enable_ocr.active);
        this._field_ocr_shortcut.connect('changed', (widget, keys) => { gsettings.set_strv(Fields.OCRSHORTCUT, [keys]); });
    }

    _bindOCRHelpMessage() {
        try {
            let proc = new Gio.Subprocess({
                argv: ['python', Me.dir.get_child('ldocr.py').get_path(), '-h'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                let label = proc.get_successful() ? stdout : stderr;
                this._ocr_help_button.set_popover(new Gtk.Popover({ child: new Gtk.Label({ label: label.trim() }) }));
            });
        } catch(e) {
            // log(e.message);
        }
    }
});

const LightDictJSON = GObject.registerClass(
class LightDictJSON extends UI.Box {
    _init(key) {
        super._init();

        this._key = key;
        this._swift = key == Fields.SCOMMANDS;
        this._cmds = gsettings.get_strv(key);
        this._buildWidgets();
        this._bindValues();
    }

    _buildWidgets() {
        let cmds = this._cmds.map(x => {
            let conf = JSON.parse(x);
            return [!!conf.enable, conf.name];
        });

        this._side = new SideBar(cmds, this._swift);
        this._pane = this._swift ? new SwiftBox() : new PopupBox();
        this.append(new UI.Frame(new UI.Box().appendS([this._side, this._pane])));
    }

    _bindValues() {
        this._side.connect('selected', this._onSelectChanged.bind(this));
        this._side.connect('clicked', this._onButtonClicked.bind(this));
        this._side.connect('changed', this._onNameChanged.bind(this));
        this._side.connect('enabled', this._onEnableToggled.bind(this));
        this._pane.connect('changed', this._onValueChanged.bind(this));
    }

    _onSelectChanged(widget, index) {
        this._pane.config = JSON.parse(this._cmds[index]);
    }

    _onNameChanged(widget, index, name) {
        let conf = JSON.parse(this._cmds[index]);
        conf.name = name;
        this._cmds[index] = JSON.stringify(conf, null, 0);
        this._saveCommands()
    }

    get enable() {
        return this._cmds.findIndex(c => !!JSON.parse(c).enable);
    }

    _onButtonClicked(widget, index, button) {
        let enable = this.enable;
        switch(button) {
        case 'go-up':
        case 'go-down':
            let swap = button == 'go-up' ? index - 1 : index + 1;
            [this._cmds[index], this._cmds[swap]] = [this._cmds[swap], this._cmds[index]]
            if(enable == swap || enable == index) this._saveCommand(enable == index ? swap : index);
            break;
        case 'list-remove':
            this._cmds.splice(index, 1);
            if(enable >= index) this._saveCommand(enable == index ? -1 : enable - 1);
            break;
        case 'list-add':
            if(index == -1) {
                this._cmds.push('{"name":"name"}');
            } else {
                this._cmds.splice(index + 1, 0, '{"name":"name"}');
                if(enable > index) this._saveCommand(enable + 1);
            }
            break;
        }
        this._saveCommands();
    }

    _onEnableToggled(widget, index, enable) {
        if(this._swift) {
            this._cmds = this._cmds.map((c, i) => {
                let conf = JSON.parse(c);
                if(enable && i == index) {
                    conf.enable = true;
                    this._saveCommand(index);
                } else {
                    delete conf.enable;
                }
                return JSON.stringify(conf, null, 0);
            });
        } else {
            let conf = JSON.parse(this._cmds[index]);
            conf.enable = enable;
            this._cmds[index] = JSON.stringify(conf, null, 0);
        }
        this._saveCommands();
    }

    _onValueChanged(widget, prop) {
        let index = this._side.selected;
        if(index === -1 || index >= this._cmds.length) return;
        let [key, value] = Object.entries(prop)[0];
        let conf = JSON.parse(this._cmds[index]);
        value ? conf[key] = value : delete conf[key];
        this._cmds[index] = JSON.stringify(conf, null, 0);
        this._saveCommands();
    }

    _saveCommand(index) {
        if(this._swift) gsettings.set_int(Fields.SCOMMAND, index);
    }

    _saveCommands() {
        gsettings.set_strv(this._key, this._cmds);
    }
});

