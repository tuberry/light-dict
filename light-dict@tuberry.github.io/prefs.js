// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Pango, GLib, Gtk, Gdk, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const _GTK = imports.gettext.domain('gtk30').gettext;
const Orna = { DOT: '\u2022', CHECK: '\u2713', NONE: ' ' }

var Fields = {
    XOFFSET:   'x-offset',
    LOGLEVEL:  'log-level',
    HIDETITLE: 'hide-title',
    LISTTYPE:  'wmlist-type',
    TXTFILTER: 'text-filter',
    WMLIST:    'wmclass-list',
    LCOMMAND:  'left-command',
    PASSIVE:   'passive-mode',
    TEXTSTRIP: 'enable-strip',
    PAGESIZE:  'icon-pagesize',
    RCOMMAND:  'right-command',
    SCOMMAND:  'swift-command',
    TRIGGER:   'trigger-style',
    PCOMMANDS: 'popup-commands',
    SCOMMANDS: 'swift-commands',
    SYSTRAY:   'enable-systray',
    TOOLTIP:   'enable-tooltip',
    AUTOHIDE:  'autohide-timeout',
};

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    return new LightDictPrefsWidget();
}

const LightDictPrefsWidget = GObject.registerClass(
class LightDictPrefsWidget extends Gtk.Stack {
    _init() {
        super._init({
            expand: true,
            transition_type: Gtk.StackTransitionType.NONE,
        });
        this._basic = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._basic.add(new LightDictBasic());
        this.add_titled(this._basic, 'basic', _('Basic'));

        this._swift = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._swift.add(new LightDictSwift());
        this.add_titled(this._swift, 'swift', _('Swift'));

        this._pop = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._pop.add(new LightDictPopup());
        this.add_titled(this._pop, 'popup', _('Popup'));

        this._about = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._about.add(new LightDictAbout());
        this.add_titled(this._about, 'about', _('About'));

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            let window = this.get_toplevel();
            window.resize(700, 620);
            let headerBar = window.get_titlebar();
            headerBar.custom_title = new Gtk.StackSwitcher({ halign: Gtk.Align.CENTER, visible: true, stack: this });
            return GLib.SOURCE_REMOVE;
        });
        this.show_all();
    }
});

const LightDictAbout = GObject.registerClass(
class LightDictAbout extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._buildIcon();
        this._buildInfo();
        this._buildTips();
    }

    _buildIcon() {
        let hbox = new Gtk.Box({
            margin_bottom: 30,
            halign: Gtk.Align.CENTER,
        });
        let active = gsettings.get_strv(Fields.PCOMMANDS);
        let count  = gsettings.get_uint(Fields.PAGESIZE);
        let icons  = [];
        let icon_size = 5;
        if(active.length) {
            active.forEach(x => {
                let y = JSON.parse(x)
                icons.push(new Gtk.Image({
                    icon_size: icon_size,
                    icon_name: y.icon || 'help',
                }));
            });
        } else {
            icons.push(new Gtk.Image({
                icon_size: icon_size,
                icon_name: 'accessories-dictionary',
            }));
        }
        count = count ? count : icons.length;
        icons.slice(0, count).forEach(x => hbox.pack_start(x, false, false, 0));
        this.add(hbox);
    }

    _buildInfo() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html';
        let license  = _GTK('GNU General Public License, version 3 or later');
        let info = [
            '<b><big>%s</big></b>'.format(Me.metadata.name),
            _('Version %d').format(Me.metadata.version),
            _('Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.'),
            '<span><a href="' + Me.metadata.url + '">' + _GTK('Website') + '</a></span>',
            '<small>' + _GTK('This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.').format(gpl, license) + '</small>'
        ];
        let about = new Gtk.Label({
            wrap: true,
            justify: 2,
            use_markup: true,
            label: info.join('\n\n'),
        });
        this.add(about);
    }

    _buildTips() {
        const tips = new Gtk.Button({
            hexpand: false,
            label: _('Tips'),
            halign: Gtk.Align.END,
        });
        let pop = new Gtk.Popover(tips);
        pop.set_relative_to(tips);

        let msgs = [
            _('Substitute <b>LDWORD</b> for the selected text in the command'),
            _('Add the icon to <i>~/.local/share/icons/hicolor/symbolic/apps/</i>'),
            _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
            _('Hold <b>Alt/Shift</b> to invoke when highlighting in <b>Passive mode</b>'),
            _('The Log file is located at <i>~/.cache/gnome-shell-extension-light-dict/</i>'),
        ];

        const vbox = new Gtk.VBox({ margin: 10 });
        msgs.map((msg, i) => {
            const label = new Gtk.Label();
            label.set_margin_top(5);
            label.set_line_wrap(true);
            label.set_alignment(0, 0.5);
            label.set_max_width_chars(60);
            label.set_markup((i + 1) + '. ' + msg);
            return label;
        }).forEach(l => vbox.add(l));
        pop.add(vbox);
        tips.connect('clicked', () => { pop.show_all(); });

        this.pack_end(tips, false, false, 0);
    }
});

const LightDictBasic = GObject.registerClass(
class LightDictBasic extends Gtk.Box {
    _init() {
        super._init({
            margin_left: 90,
            margin_right: 90,
            margin_bottom: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._buildWidgets();
        this._bulidUI();
        this._bindValues();
        this._syncStatus();
    }

    _buildWidgets() {
        this._field_enable_strip    = new Gtk.Switch();
        this._field_enable_systray  = new Gtk.Switch();
        this._field_enable_tooltips = new Gtk.Switch();
        this._field_hide_title      = new Gtk.Switch();

        this._field_page_size    = this._spinMaker(1, 10, 1);
        this._field_icon_xoffset = this._spinMaker(-400, 400, 50);
        this._field_auto_hide    = this._spinMaker(500, 10000, 250);

        this._field_list_type     = this._comboMaker([_('Blocklist'), _('Allowlist')]);
        this._field_trigger_style = this._comboMaker([_('Swift'), _('Popup'), _('Disable')]);
        this._field_log_level     = this._comboMaker([_('Never'), _('Click'), _('Hover'), _('Always')]);
        this._field_passive_mode  = this._comboMaker([_('Proactive'), _('Passive')], _('Need modifier to trigger or not'));

        this._field_left_command  = this._entryMaker('notify-send LDWORD', _('Left click to execute'));
        this._field_text_filter   = this._entryMaker('^[^\\n\\.\\t/:]{3,50}$', _('Text RegExp filter in Passive mode'));
        this._field_wmclass_list  = this._entryMaker('Yelp,Evince', _('Allowlist/blocklist (leave blank to indicate all)'));
        this._field_right_command = this._entryMaker('gio open https://www.google.com/search?q=LDWORD', _('Right click to execute and hide panel'));
    }

    _bulidUI() {
        let common = this._listFrameMaker(_('Common'));
        common._add(this._labelMaker(_('Enable systray')),     this._field_enable_systray);
        common._add(this._labelMaker(_('Trim whitespaces')),   this._field_enable_strip);
        common._add(this._labelMaker(_('Autohide interval')),  this._field_auto_hide);
        common._add(this._labelMaker(_('Trigger style')),      this._field_passive_mode, this._field_trigger_style);
        common._att(this._labelMaker(_('WMclass list'), true), this._field_wmclass_list, this._field_list_type);
        common._att(this._labelMaker(_('Text filter'), true), this._field_text_filter);

        let panel = this._listFrameMaker(_('Panel'));
        panel._add(this._labelMaker(_('Hide title')), this._field_hide_title);
        panel._add(this._labelMaker(_('Logs level')), this._field_log_level);
        panel._att(this._labelMaker(_('Right click'), true), this._field_right_command);
        panel._att(this._labelMaker(_('Left click'), true),  this._field_left_command);

        let popup = this._listFrameMaker(_('Popup'));
        popup._add(this._labelMaker(_('Enable tooltips')),   this._field_enable_tooltips);
        popup._add(this._labelMaker(_('Page size')),         this._field_page_size);
        popup._add(this._labelMaker(_('Horizontal offset')), this._field_icon_xoffset);
    }

    _syncStatus() {
        this._toggleEditable(this._field_wmclass_list,  gsettings.get_string(Fields.WMLIST));
        this._toggleEditable(this._field_left_command,  gsettings.get_string(Fields.LCOMMAND));
        this._toggleEditable(this._field_right_command, gsettings.get_string(Fields.RCOMMAND));
        this._toggleEditable(this._field_text_filter,   gsettings.get_string(Fields.TXTFILTER));
    }

    _toggleEditable(entry, str) {
        entry.set_editable(!str);
        entry.secondary_icon_name = !str ? 'document-edit-symbolic' : 'action-unavailable-symbolic';
    }

    _bindValues() {
        gsettings.bind(Fields.TXTFILTER, this._field_text_filter,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.RCOMMAND,  this._field_right_command,   'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LCOMMAND,  this._field_left_command,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.WMLIST,    this._field_wmclass_list,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,  this._field_auto_hide,       'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,  this._field_page_size,       'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.XOFFSET,   this._field_icon_xoffset,    'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOGLEVEL,  this._field_log_level,       'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,   this._field_trigger_style,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LISTTYPE,  this._field_list_type,       'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SYSTRAY,   this._field_enable_systray,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE, this._field_hide_title,      'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP, this._field_enable_strip,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIP,   this._field_enable_tooltips, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PASSIVE,   this._field_passive_mode,    'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _listFrameMaker(lbl) {
        let frame = new Gtk.Frame({
            label_yalign: 1,
            shadow_type: Gtk.ShadowType.IN,
        });
        frame.set_label_widget(new Gtk.Label({
            use_markup: true,
            margin_top: 30,
            label: '<b><big>' + lbl + '</big></b>',
        }));
        this.add(frame);

        frame.grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
            row_homogeneous: false,
            column_homogeneous: false,
        });

        frame.grid._row = 0;
        frame.add(frame.grid);
        frame._add = (x, y, z) => {
            let hbox = new Gtk.Box();
            hbox.pack_start(x, true, true, 0);
            hbox.pack_start(y, false, false, 4);
            if(z) hbox.pack_start(z, false, false, 4);
            frame.grid.attach(hbox, 0, frame.grid._row++, 2, 1);
        }
        frame._att = (x, y, z) => {
            let r = frame.grid._row++;
            if(z) {
                let hbox = new Gtk.Box();
                hbox.pack_start(y, true, true, 4);
                hbox.pack_start(z, false, false, 4);
                frame.grid.attach(x, 0, r, 1, 1);
                frame.grid.attach(hbox, 1, r, 1, 1);
            } else {
                frame.grid.attach(x, 0, r, 1, 1);
                frame.grid.attach(y, 1, r, 1, 1);
            }
        }
        return frame;
    }

    _spinMaker(l, u, s) {
        return new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: l,
                upper: u,
                step_increment: s,
            }),
        });
    }

    _labelMaker(x, y) {
        return new Gtk.Label({
            label: x,
            hexpand: y ? false : true,
            halign: Gtk.Align.START,
        });
    }

    _entryMaker(x, y) {
        let entry = new Gtk.Entry({
            hexpand: true,
            editable: false,
            placeholder_text: x,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: 'action-unavailable',
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = 'action-unavailable'
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = 'document-edit-symbolic';
            }
        });
        return entry;
    }

    _comboMaker(ops, tip) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l });
        let r = new Gtk.CellRendererText();
        if(tip) c.set_tooltip_text(tip);
        c.pack_start(r, false);
        c.add_attribute(r, 'text', 0);
        return c;
    }
});

const LightDictPopup = GObject.registerClass(
class LightDictPopup extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
        });

        this.isNew = true;
        this.isSetting = false;

        this._commands = gsettings.get_strv(Fields.PCOMMANDS);
        this._buildWidgets();
        this._buildUI();
        this._syncStatus();
    }

    _buildWidgets() {
        this._tre = this._treeViewMaker(this._commands);

        this._add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-add-symbolic' }) });
        this._del = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-remove-symbolic' }) });
        this._nxt = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-down-symbolic' }) });
        this._prv = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-up-symbolic' }) });

        this._ebl = new Gtk.Switch();
        this._pop = new Gtk.Switch();
        this._cmt = new Gtk.Switch();
        this._sel = new Gtk.Switch();
        this._cpy = new Gtk.Switch();
        this._typ = this._comboMaker(['sh', 'JS'], _('Command type'));
        this._nam = this._entryMaker('Link', _('Showing on the left side'), true);
        this._ico = this._entryMaker('face-cool-symbolic', _('Showing in the popup icon bar'), true);
        this._cmd = this._entryMaker('gio open LDWORD', _('Executed when clicking'));
        this._win = this._entryMaker('Yelp,Evince,Gedit', _('Allowed to function'));
        this._tip = this._entryMaker('Open URL with gio open', _('Showing when hovering'));
        this._reg = this._entryMaker('(https?|ftp|file)://.*', _('Text RegExp matcher'));
    }

    _buildUI() {
        let leftBox = new Gtk.VBox({});
        let toolBar = new Gtk.HBox({});
        toolBar.pack_start(this._add, false, false, 2);
        toolBar.pack_start(this._del, false, false, 2);
        toolBar.pack_start(this._nxt, false, false, 2);
        toolBar.pack_start(this._prv, false, false, 2);
        leftBox.pack_start(this._tre, true, true, 0);
        leftBox.pack_start(new Gtk.Separator(), false, false, 0);
        leftBox.pack_end(toolBar, false, false, 0);

        let rightBox = new Gtk.VBox({});
        let basic = this._listGridMaker();
        basic._add(this._labelMaker(_('Enable')), this._ebl);
        basic._add(this._labelMaker(_('Name'), true), this._nam);
        rightBox.pack_start(basic, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let details = this._listGridMaker();
        details._add(this._labelMaker(_('Icon')), this._ico);
        details._att(this._labelMaker(_('Command'), true), this._cmd);
        details._add(this._labelMaker(_('Command type')), this._typ);
        details._add(this._labelMaker(_('Show result')), this._pop);
        details._add(this._labelMaker(_('Copy result')), this._cpy);
        details._add(this._labelMaker(_('Select result')), this._sel);
        details._add(this._labelMaker(_('Commit result')), this._cmt);
        rightBox.pack_start(details, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let addition = this._listGridMaker();
        addition._att(this._labelMaker(_('Regexp'), true), this._reg);
        addition._att(this._labelMaker(_('WMclass'), true), this._win);
        addition._att(this._labelMaker(_('Tooltip'), true), this._tip);
        rightBox.pack_start(addition, false, false, 0);

        let outBox = new Gtk.HBox();
        outBox.pack_start(leftBox, false, false, 0);
        outBox.pack_start(new Gtk.Separator(), false, false, 0);
        outBox.pack_end(rightBox, true, true, 0);

        this.add(this._frameWrapper(outBox));
    }

    _syncStatus() {
        this._tre.get_selection().connect('changed', this._onSelected.bind(this));

        this._add.connect('clicked', this._onAddClicked.bind(this));
        this._del.connect('clicked', this._onDelClicked.bind(this));
        this._prv.connect('clicked', this._onPrvClicked.bind(this));
        this._nxt.connect('clicked', this._onNxtClicked.bind(this));

        this._ebl.connect('state-set', (widget, state) => { this._setConfig('enable', state); });
        this._pop.connect('state-set', (widget, state) => { this._setConfig('popup', state); });
        this._cmt.connect('state-set', (widget, state) => { this._setConfig('commit', state); });
        this._sel.connect('state-set', (widget, state) => { this._setConfig('select', state); });
        this._cpy.connect('state-set', (widget, state) => { this._setConfig('copy', state); });
        this._typ.connect('changed', widget => { this._setConfig('type', widget.get_active()); });
        this._reg.connect('changed', widget => { this._setConfig('regexp', widget.get_text()); });
        this._cmd.connect('changed', widget => { this._setConfig('command', widget.get_text()); });
        this._win.connect('changed', widget => { this._setConfig('wmclass', widget.get_text()); });
        this._tip.connect('changed', widget => { this._setConfig('tooltip', widget.get_text()); });
        this._ico.connect('changed', widget => { this._setConfig('icon', widget.get_text()); });
        this._nam.connect('changed', widget => { this._setConfig('name', widget.get_text()); });
    }

    _onSelected() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.isSetting = true;
        this.conf = JSON.parse(this._commands[index]);
        this._typ.set_active(this.conf.type || 0);
        this._cpy.set_state(this.conf.copy || false);
        this._cmt.set_state(this.conf.commit || false);
        this._sel.set_state(this.conf.select || false);
        this._pop.set_state(this.conf.popup || false);
        this._ebl.set_state(this.conf.enable || false);
        this._ico.set_text(this.conf.icon || '');
        this._nam.set_text(this.conf.name || 'name');
        this._win.set_text(this.conf.wmclass || '')
        this._cmd.set_text(this.conf.command || '');
        this._reg.set_text(this.conf.regexp || '');
        this._tip.set_text(this.conf.tooltip || '');
        this._toggleEditable();
        this.isSetting = false;
    }

    _toggleEditable() {
        let toggle = (x, y) => {
            x.set_editable(y);
            x.secondary_icon_name = y ? 'document-edit-symbolic' : 'action-unavailable-symbolic';
        };
        toggle(this._nam, !this.conf.name || this.conf.name == 'name');
        toggle(this._ico, !this.conf.icon);
        toggle(this._cmd, !this.conf.command);
        toggle(this._win, !this.conf.wmclass);
        toggle(this._reg, !this.conf.regexp);
        toggle(this._tip, !this.conf.tooltip);
    }

    get selected() {
        let [ok, model, iter] = this._tre.get_selection().get_selected();
        return [ok, model, iter, ok ? model.get_path(iter).get_indices()[0] : -1];
    }

    _onPrvClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index === 0) return;

        [this._commands[index], this._commands[index - 1]] = [this._commands[index - 1], this._commands[index]]
        let p = JSON.parse(this._commands[index]);
        let q = JSON.parse(this._commands[index - 1]);
        model.set(iter, [0, 1], [p.enable ? Orna.CHECK : Orna.NONE, p.name]);
        model.iter_previous(iter);
        model.set(iter, [0, 1], [q.enable ? Orna.CHECK : Orna.NONE, q.name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onNxtClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index >= this._commands.length - 1) return;

        [this._commands[index], this._commands[index + 1]] = [this._commands[index + 1], this._commands[index]]
        let p = JSON.parse(this._commands[index]);
        let q = JSON.parse(this._commands[index + 1]);
        model.set(iter, [0, 1], [p.enable ? Orna.CHECK : Orna.NONE, p.name]);
        model.iter_next(iter);
        model.set(iter, [0, 1], [q.enable ? Orna.CHECK : Orna.NONE, q.name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onDelClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;

        this._commands.splice(index, 1);
        model.remove(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onAddClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) {
            this._commands.splice(0, 0, '{"name":"name"}');
            model.set(model.insert(0), [0, 1], [Orna.NONE, 'name']);
            gsettings.set_strv(Fields.PCOMMANDS, this._commands);
            return;
        }

        this._commands.splice(index + 1, 0, '{"name":"name"}');
        model.set(model.insert(index + 1), [1], ['name']);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _setConfig(key, value) {
        if(this.isSetting) return;
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        if(key == 'name')
            model.set(iter, [1], [value]);
        if(key == 'enable')
            model.set(iter, [0], [value ? Orna.CHECK : Orna.NONE])
        if(!value) {
            delete this.conf[key];
        } else {
            this.conf[key] = value;
        }
        this._commands[index] = JSON.stringify(this.conf, null, 0);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _frameWrapper(widget) {
        let frame = new Gtk.Frame();
        frame.add(widget);
        return frame;
    }

    _treeViewMaker(commands) {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);
        let treeView = new Gtk.TreeView({ model: listStore, headers_visible: false });
        commands.forEach(x => {
            let conf = JSON.parse(x);
            listStore.set(listStore.append(), [0, 1], [!!conf.enable ? Orna.CHECK : Orna.NONE, conf.name]);
        });

        let enable = new Gtk.CellRendererText({ editable: false });
        let status = new Gtk.TreeViewColumn({ title: 'Status' });
        status.pack_start(enable, false);
        status.add_attribute(enable, 'text', 0);
        treeView.append_column(status);

        let text = new Gtk.CellRendererText({ editable: false });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(text, true);
        name.add_attribute(text, 'text', 1);
        treeView.append_column(name);

        return treeView;
    }

    _treeeViewMaker(commands) {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_STRING]);
        let treeView = new Gtk.TreeView({ model: listStore });

        let cell = new Gtk.CellRendererText({ editable: false });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(cell, true);
        name.add_attribute(cell, 'text', 0);
        treeView.append_column(name);
        treeView.set_headers_visible(false);
        // treeView.set_grid_lines(Gtk.TreeViewGridLines.HORIZONTAL);
        commands.forEach(x => {
            let conf = JSON.parse(x);
            treeView.model.set(treeView.model.append(), [0], [conf.name]);
        });

        return treeView;
    }

    _listGridMaker() {
        let grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
        });

        grid._row = 0;
        grid._add = (x, y) => {
            const hbox = new Gtk.Box();
            hbox.pack_start(x, true, true, 0);
            hbox.pack_start(y, false, false, 0)
            grid.attach(hbox, 0, grid._row++, 2, 1);
        }
        grid._att = (x, y, z) => {
            let r = grid._row++;
            if(z) {
                let hbox = new Gtk.Box();
                hbox.pack_start(y, false, false, 4);
                hbox.pack_start(z, true, true, 4);
                grid.attach(x, 0, r, 1, 1);
                grid.attach(hbox, 1, r, 1, 1);
            } else {
                grid.attach(x, 0, r, 1, 1);
                grid.attach(y, 1, r, 1, 1);
            }
        }

        return grid;
    }

    _labelMaker(x, y) {
        return new Gtk.Label({
            label: x,
            hexpand: y ? false : true,
            halign: Gtk.Align.START,
        });
    }

    _entryMaker(x, y, z) {
        let entry = new Gtk.Entry({
            editable: false,
            placeholder_text: x,
            hexpand: z ? false : true,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: 'action-unavailable',
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = 'action-unavailable'
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = 'document-edit-symbolic';
            }
        });
        return entry;
    }

    _comboMaker(ops, tip) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l });
        let r = new Gtk.CellRendererText();
        if(tip) c.set_tooltip_text(tip);
        c.pack_start(r, false);
        c.add_attribute(r, 'text', 0);
        return c;
    }
});

const LightDictSwift = GObject.registerClass(
class LightDictSwift extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
        });

        this.isNew = true;
        this.isSetting = false;

        this._commands = gsettings.get_strv(Fields.SCOMMANDS);
        this._buildWidgets();
        this._buildUI();
        this._syncStatus();
    }

    _buildWidgets() {
        this._tre = this._treeViewMaker(this._commands);

        this._add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-add-symbolic' }) });
        this._del = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-remove-symbolic' }) });
        this._nxt = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-down-symbolic' }) });
        this._prv = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-up-symbolic' }) });

        this._ebl = new Gtk.Switch();
        this._pop = new Gtk.Switch();
        this._cmt = new Gtk.Switch();
        this._cpy = new Gtk.Switch();
        this._sel = new Gtk.Switch();
        this._typ = this._comboMaker(['sh', 'JS'], _('Command type'));
        this._nam = this._entryMaker('Link', _('Showing on the left side'), true);
        this._win = this._entryMaker('yelp,evince,gedit', _('Allowed to function'));
        this._cmd = this._entryMaker('gio open LDWORD', _('Executed when clicking'));
        this._reg = this._entryMaker('(https?|ftp|file)://.*', _('Text RegExp matcher'));
    }

    _buildUI() {
        let leftBox = new Gtk.VBox({});
        let toolBar = new Gtk.HBox({});
        toolBar.pack_start(this._add, false, false, 2);
        toolBar.pack_start(this._del, false, false, 2);
        toolBar.pack_start(this._nxt, false, false, 2);
        toolBar.pack_start(this._prv, false, false, 2);
        leftBox.pack_start(this._tre, true, true, 0);
        leftBox.pack_start(new Gtk.Separator(), false, false, 0);
        leftBox.pack_end(toolBar, false, false, 0);

        let rightBox = new Gtk.VBox({});
        let basic = this._listGridMaker();
        basic._add(this._labelMaker(_('Enable')), this._ebl);
        basic._add(this._labelMaker(_('Name'), true), this._nam);
        rightBox.pack_start(basic, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let details = this._listGridMaker();
        details._att(this._labelMaker(_('Command'), true), this._cmd);
        details._add(this._labelMaker(_('Command type')), this._typ);
        details._add(this._labelMaker(_('Show result')), this._pop);
        details._add(this._labelMaker(_('Copy result')), this._cpy);
        details._add(this._labelMaker(_('Select result')), this._sel);
        details._add(this._labelMaker(_('Commit result')), this._cmt);
        rightBox.pack_start(details, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let addition = this._listGridMaker();
        addition._att(this._labelMaker(_('Regexp'), true), this._reg);
        addition._att(this._labelMaker(_('WMclass'), true), this._win);
        rightBox.pack_start(addition, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let info = this._listGridMaker();
        info._att(this._labelMaker(_('Only one item can be enabled in swift mode.\nIf none is enabled the first one will be used by default.')));
        rightBox.pack_start(info, false, false, 0);

        let outBox = new Gtk.HBox();
        outBox.pack_start(leftBox, false, false, 0);
        outBox.pack_start(new Gtk.Separator(), false, false, 0);
        outBox.pack_end(rightBox, true, true, 0);

        this.add(this._frameWrapper(outBox));
    }

    _syncStatus() {
        this._tre.get_selection().connect('changed', this._onSelected.bind(this));

        this._add.connect('clicked', this._onAddClicked.bind(this));
        this._del.connect('clicked', this._onDelClicked.bind(this));
        this._prv.connect('clicked', this._onPrvClicked.bind(this));
        this._nxt.connect('clicked', this._onNxtClicked.bind(this));

        this._ebl.connect('state-set', (widget, state) => { this._setConfig('enable', state); });
        this._pop.connect('state-set', (widget, state) => { this._setConfig('popup', state); });
        this._cmt.connect('state-set', (widget, state) => { this._setConfig('commit', state); });
        this._sel.connect('state-set', (widget, state) => { this._setConfig('select', state); });
        this._cpy.connect('state-set', (widget, state) => { this._setConfig('copy', state); });
        this._typ.connect('changed', widget => { this._setConfig('type', widget.get_active()); });
        this._reg.connect('changed', widget => { this._setConfig('regexp', widget.get_text()); });
        this._cmd.connect('changed', widget => { this._setConfig('command', widget.get_text()); });
        this._win.connect('changed', widget => { this._setConfig('wmclass', widget.get_text()); });
        this._nam.connect('changed', widget => { this._setConfig('name', widget.get_text()); });
    }

    _onSelected() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.isSetting = true;
        this.conf = JSON.parse(this._commands[index]);
        this._typ.set_active(this.conf.type || 0);
        this._cpy.set_state(this.conf.copy || false);
        this._cmt.set_state(this.conf.commit || false);
        this._sel.set_state(this.conf.select || false);
        this._pop.set_state(this.conf.popup || false);
        this._ebl.set_state(this.conf.enable || false);
        this._nam.set_text(this.conf.name || 'name');
        this._win.set_text(this.conf.wmclass || '')
        this._cmd.set_text(this.conf.command || '');
        this._reg.set_text(this.conf.regexp || '');
        this._toggleEditable();
        this.isSetting = false;
    }

    _toggleEditable() {
        let toggle = (x, y) => {
            x.set_editable(y);
            x.secondary_icon_name = y ? 'document-edit-symbolic' : 'action-unavailable-symbolic';
        };
        toggle(this._nam, !this.conf.name || this.conf.name == 'name');
        toggle(this._cmd, !this.conf.command);
        toggle(this._win, !this.conf.wmclass);
        toggle(this._reg, !this.conf.regexp);
    }

    _clearOrnament() {
        let model = this._tre.model;
        let [ok, iter] = model.get_iter_first();
        if(!ok) return;
        do {
            model.set(iter, [0], ['']);
        } while(model.iter_next(iter));
        this._commands = this._commands.map(c => {
            let conf = JSON.parse(c);
            delete conf['enable'];
            return JSON.stringify(conf, null, 0);
        })
    }

    get selected() {
        let [ok, model, iter] = this._tre.get_selection().get_selected();
        return [ok, model, iter, ok ? model.get_path(iter).get_indices()[0] : -1];
    }

    get enabled() {
        return gsettings.get_int(Fields.SCOMMAND);
    }

    get enable() {
        return this._commands.findIndex(c => !!JSON.parse(c).enable);
    }

    _onPrvClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index === 0) return;

        [this._commands[index], this._commands[index - 1]] = [this._commands[index - 1], this._commands[index]]
        let enable = this.enable;
        model.set(iter, [0, 1], [enable == index ? Orna.DOT : Orna.NONE, JSON.parse(this._commands[index]).name]);
        model.iter_previous(iter);
        model.set(iter, [0, 1], [enable == index - 1 ? Orna.DOT : Orna.NONE, JSON.parse(this._commands[index - 1]).name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
    }

    _onNxtClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index >= this._commands.length - 1) return;

        [this._commands[index], this._commands[index + 1]] = [this._commands[index + 1], this._commands[index]]
        let enable = this.enable;
        model.set(iter, [0, 1], [enable == index ? Orna.DOT : Orna.NONE, JSON.parse(this._commands[index]).name]);
        model.iter_next(iter);
        model.set(iter, [0, 1], [enable == index + 1 ? Orna.DOT : Orna.NONE, JSON.parse(this._commands[index + 1]).name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
    }

    _onDelClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;

        this._commands.splice(index, 1);
        let enable = this.enable;
        model.remove(iter);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
    }

    _onAddClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) {
            this._commands.splice(0, 0, '{"name":"name"}');
            model.set(model.insert(0), [0, 1], [Orna.NONE, 'name']);
            gsettings.set_strv(Fields.SCOMMANDS, this._commands);
            return;
        }

        this._commands.splice(index + 1, 0, '{"name":"name"}');
        let enable = this.enable;
        model.set(model.insert(index + 1), [0, 1], [Orna.NONE, 'name']);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
    }

    _setConfig(key, value) {
        if(this.isSetting) return;
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        if(key == 'name')
            model.set(iter, [1], [value]);
        if(key == 'enable') {
            this._clearOrnament();
            if(value) {
                this.conf[key] = value;
                model.set(iter, [0], [Orna.DOT]);
            } else {
                delete this.conf[key];
            }
        } else {
            if(!value) {
                delete this.conf[key];
            } else {
                this.conf[key] = value;
            }
        }
        this._commands[index] = JSON.stringify(this.conf, null, 0);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
        if(this.conf.enable) gsettings.set_int(Fields.SCOMMAND, index);
    }

    _frameWrapper(widget) {
        let frame = new Gtk.Frame();
        frame.add(widget);
        return frame;
    }

    _treeViewMaker(commands) {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);
        let treeView = new Gtk.TreeView({ model: listStore, headers_visible: false });
        commands.forEach(x => {
            let conf = JSON.parse(x);
            listStore.set(listStore.append(), [0, 1], [!!conf.enable ? Orna.DOT : Orna.NONE, conf.name]);
        });

        // NOTE: the radio is not togglable
        // let enable = new Gtk.CellRendererToggle({ radio: false });
        // let status = new Gtk.TreeViewColumn({ title: 'Enable' });
        // status.add_attribute(enable, 'active', 0);
        // status.pack_start(enable, true);
        // treeView.append_column(status);
        // enable.connect('toggled', (actor, path) => {
        //     let active = !actor.get_active();
        //     let [ok, iter] = listStore.get_iter_from_string(path);
        //     listStore.set(iter, [0], [active]);
        // });
        let enable = new Gtk.CellRendererText({ editable: false });
        let status = new Gtk.TreeViewColumn({ title: 'Status' });
        status.pack_start(enable, false);
        status.add_attribute(enable, 'text', 0);
        treeView.append_column(status);

        let text = new Gtk.CellRendererText({ editable: false });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(text, true);
        name.add_attribute(text, 'text', 1);
        treeView.append_column(name);
        // treeView.set_grid_lines(Gtk.TreeViewGridLines.HORIZONTAL);
        return treeView;
    }

    _listGridMaker() {
        let grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
        });

        grid._row = 0;
        grid._add = (x, y) => {
            const hbox = new Gtk.Box();
            hbox.pack_start(x, true, true, 0);
            hbox.pack_start(y, false, false, 0)
            grid.attach(hbox, 0, grid._row++, 2, 1);
        }
        grid._att = (x, y, z) => {
            let r = grid._row++;
            if(z) {
                let hbox = new Gtk.Box();
                hbox.pack_start(y, false, false, 4);
                hbox.pack_start(z, true, true, 4);
                grid.attach(x, 0, r, 1, 1);
                grid.attach(hbox, 1, r, 1, 1);
            } else if(y) {
                grid.attach(x, 0, r, 1, 1);
                grid.attach(y, 1, r, 1, 1);
            } else {
                grid.attach(x, 0, r, 1, 2)
            }
        }

        return grid;
    }

    _labelMaker(x, y) {
        return new Gtk.Label({
            label: x,
            hexpand: y ? false : true,
            halign: Gtk.Align.START,
        });
    }

    _entryMaker(x, y, z) {
        let entry = new Gtk.Entry({
            editable: false,
            placeholder_text: x,
            hexpand: z ? false : true,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: 'action-unavailable',
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = 'action-unavailable'
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = 'document-edit-symbolic';
            }
        });
        return entry;
    }

    _comboMaker(ops, tip) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l });
        let r = new Gtk.CellRendererText();
        if(tip) c.set_tooltip_text(tip);
        c.pack_start(r, false);
        c.add_attribute(r, 'text', 0);
        return c;
    }
});

