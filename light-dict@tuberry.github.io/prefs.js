// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Pango, GLib, Gtk, GtkSource, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

var Fields = {
    SENSITIVE:    'sensitive-mode',
    AUTOHIDE:     'autohide-timeout',
    LOGSLEVEL:    'log-level',
    TRIGGER:      'trigger-style',
    APPSLIST:     'application-list',
    BLACKWHITE:   'black-or-white',
    FILTER:       'selection-filter',
    OPENURL:      'open-url',
    CCOMMAND:     'click-command',
    DCOMMAND:     'dict-command',
    SHORTCUT:     'enable-shortcut',
    EDITABLE:     'command-editable',
    ICOMMANDS:    'icon-commands',
    ACOMMANDS:    'icon-commands-active',
    SHORTCUTNAME: 'short-cut',
    XOFFSET:      'x-offset',
    YOFFSET:      'y-offset',
    HIDETITLE:    'hide-panel-title',
    PAGESIZE:     'icon-pagesize',
    TEXTSTRIP:    'enable-strip',
    TOOLTIPS:     'enable-tooltips',
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
        super._init();
        this._basic = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._basic.add(new LightDictBasic());
        this.add_titled(this._basic, 'basic', _('Basic'));

        this._advanced = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._advanced.add(new LightDictAdvanced());
        this.add_titled(this._advanced, 'advanced', _('Advanced'));

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            let window = this.get_toplevel();
            window.resize(600,600);
            let headerBar = window.get_titlebar();
            headerBar.custom_title = new Gtk.StackSwitcher({halign: Gtk.Align.CENTER, visible: true, stack: this});
            return GLib.SOURCE_REMOVE;
        });
        this.show_all();
    }
});

const LightDictBasic = GObject.registerClass(
class LightDictBasic extends Gtk.Grid {
    _init() {
        super._init({
            margin: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });

        this._buildWidgets();
        this._bulidUI();
        this._bindValues();
        this._syncStatus();
    }

    _buildWidgets() {
        this._field_sensitive_mode    = new Gtk.Switch();
        this._field_command_editable  = new Gtk.Switch();
        this._field_hide_panel_title  = new Gtk.Switch();
        this._field_enable_strip      = new Gtk.Switch();
        this._field_black_or_white    = new Gtk.Switch();
        this._field_enable_tooltips   = new Gtk.Switch();

        this._field_auto_hide         = this._spinMaker(500, 10000, 250);
        this._field_icon_pagesize     = this._spinMaker(0, 10, 1);
        this._field_icon_xoffset      = this._spinMaker(-400,400,5);
        this._field_icon_yoffset      = this._spinMaker(-400,400,5);

        this._field_log_level         = this._comboMaker([_('Never'), _('Click'), _('Hover'), _('Always')]);
        this._field_trigger_style     = this._comboMaker([_('Icon'), _('Keyboard'), _('Auto')]);

        this._field_enable_keybinding = new Gtk.Switch();
        this._field_keybinding        = this._shortCutMaker(Fields.SHORTCUTNAME);

        this._field_apps_list         = this._entryMaker('Yelp#Evince', _('App white/black list (asterisk for all)'));
        this._field_filter            = this._entryMaker('^[^\\n\\.\\t/:]{3,50}$', _('Text RegExp filter for auto mode'));
        this._field_click_command     = this._entryMaker('notify-send hello', _('Left click: command to run when clicking panel'));
        this._field_open_url          = this._entryMaker('https://zh.wikipedia.org/w/?search=LDWORD', _('Right click: search in default browser'));
        this._field_dict_command      = this._entryMaker("dict -- LDWORD", _('Command to run in auto mode'));

        this._field_enable_keybinding.connect("notify::active", widget => {
            this._field_keybinding.set_sensitive(widget.active);
        });
        this._field_command_editable.connect("notify::active", widget => {
            this._field_apps_list.set_sensitive(widget.active);
            this._field_filter.set_sensitive(widget.active);
            this._field_click_command.set_sensitive(widget.active);
            this._field_open_url.set_sensitive(widget.active);
            this._field_dict_command.set_sensitive(widget.active);
        });
    }

    _bulidUI() {
        this._row = 0;
        const hseparator = () => new Gtk.HSeparator({margin_bottom: 5, margin_top: 5});
        this._addRow(this._field_log_level,         this._labelMaker(_("When to write down")));
        this._addRow(this._field_trigger_style,     this._labelMaker(_("How to popup panel")));
        this._addRow(this._field_auto_hide,         this._labelMaker(_("Auto hide interval")));
        this._addRow(this._field_icon_pagesize,     this._labelMaker(_("Icon bar page size")));
        this._addRow(this._field_icon_xoffset,      this._labelMaker(_("Icon bar X offset")));
        this._addRow(this._field_icon_yoffset,      this._labelMaker(_("Icon bar Y offset")));
        this._addRow(this._field_hide_panel_title,  this._labelMaker(_("Hide popup panel title")));
        this._addRow(this._field_sensitive_mode,    this._labelMaker(_("Panel seamless mode")));
        this._addRow(this._field_black_or_white,    this._labelMaker(_("Blacklist or whitelist")));
        this._addRow(this._field_enable_tooltips,   this._labelMaker(_("Enable tooltip for icon")));
        this._addRow(this._field_enable_strip,      this._labelMaker(_("Trim extra whitespaces")));
        this._addRow(hseparator(),                  null);
        this._addRow(this._field_enable_keybinding, this._labelMaker(_("Shortcuts to trigger")));
        this._addRow(this._field_keybinding,        this._labelMaker(_(" show popup panel")));
        this._addRow(hseparator(),                  null);
        this._addRow(this._field_command_editable,  this._labelMaker(_("Edit entries below")));
        this._addRow(this._field_dict_command,      null);
        this._addRow(this._field_apps_list,         null);
        this._addRow(this._field_open_url,          null);
        this._addRow(this._field_click_command,     null);
        this._addRow(this._field_filter,            null);
    }

    _syncStatus() {
        this._field_keybinding.set_sensitive(this._field_enable_keybinding.get_state());
        this._field_apps_list.set_sensitive(this._field_command_editable.get_state());
        this._field_filter.set_sensitive(this._field_command_editable.get_state());
        this._field_click_command.set_sensitive(this._field_command_editable.get_state());
        this._field_open_url.set_sensitive(this._field_command_editable.get_state());
        this._field_dict_command.set_sensitive(this._field_command_editable.get_state());
    }

    _bindValues() {
        gsettings.bind(Fields.FILTER,     this._field_filter,            'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DCOMMAND,   this._field_dict_command,      'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OPENURL,    this._field_open_url,          'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.CCOMMAND,   this._field_click_command,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.APPSLIST,   this._field_apps_list,         'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,   this._field_auto_hide,         'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,   this._field_icon_pagesize,     'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.XOFFSET,    this._field_icon_xoffset,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.YOFFSET,    this._field_icon_yoffset,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SENSITIVE,  this._field_sensitive_mode,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOGSLEVEL,  this._field_log_level,         'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,    this._field_trigger_style,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SHORTCUT,   this._field_enable_keybinding, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE,  this._field_hide_panel_title,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.EDITABLE,   this._field_command_editable,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP,  this._field_enable_strip,      'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.BLACKWHITE, this._field_black_or_white,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIPS,   this._field_enable_tooltips,   'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _spinMaker(l, u, s) {
        return new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: l,
                upper: u,
                step_increment: s,
            })
        });
    }

    _addRow(input, label) {
        let widget = input;
        if (input instanceof Gtk.Switch) {
            widget = new Gtk.HBox();
            widget.pack_end(input, false, false, 0);
        }
        if (label) {
            this.attach(label, 0, this._row, 1, 1);
            this.attach(widget, 1, this._row, 1, 1);
        } else {
            this.attach(widget, 0, this._row, 2, 1);
        }
        this._row++;
    }

    _labelMaker(x) {
        return new Gtk.Label({
            label: x,
            hexpand: true,
            halign: Gtk.Align.START
        });
    }

    _entryMaker(x, y) {
        return new Gtk.Entry({
            hexpand: true,
            placeholder_text: x,
            secondary_icon_name: "dialog-information-symbolic",
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_sensitive: true
        });
    }

    _comboMaker(ops) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.map(name => ({name})).forEach((p,i) => l.set(l.append(),[0],[p.name]));
        let c = new Gtk.ComboBox({model: l});
        let r = new Gtk.CellRendererText();
        c.pack_start(r, false);
        c.add_attribute(r, "text", 0);
        return c;
    }

    _shortCutMaker(hotkey) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);

        const row = model.insert(0);
        let [key, mods] = Gtk.accelerator_parse(gsettings.get_strv(hotkey)[0]);
        model.set(row, [0, 1], [mods, key]);

        let treeView = new Gtk.TreeView({model: model});
        treeView.set_headers_visible(false);
        let accelerator = new Gtk.CellRendererAccel({
            'editable': true,
            'accel-mode': Gtk.CellRendererAccelMode.GTK
        });

        accelerator.connect('accel-edited', (r, iter, key, mods) => {
            let value = Gtk.accelerator_name(key, mods);
            let [succ, iterator] = model.get_iter_from_string(iter);
            model.set(iterator, [0, 1], [mods, key]);
            if (key != 0) {
                gsettings.set_strv(hotkey, [value]);
            }
        });

        let column = new Gtk.TreeViewColumn({});
        column.pack_start(accelerator, false);
        column.add_attribute(accelerator, 'accel-mods', 0);
        column.add_attribute(accelerator, 'accel-key', 1);
        treeView.append_column(column);

        return treeView;
    }
});

const LightDictAdvanced = GObject.registerClass(
class LightDictAdvanced extends Gtk.Grid {
    _init() {
        super._init({
            margin: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false,
        });
        this._initStrings();

        this._cmdsList = gsettings.get_strv(Fields.ICOMMANDS);
        this._cmdsActive = gsettings.get_strv(Fields.ACOMMANDS);
        this._default = JSON.stringify(JSON.parse(this.DEFAULTLINK), null, 0);
        this._templete = JSON.stringify(JSON.parse(this.TEMPLETE), null, 0);
        this._boxes = [];
        this._add = false;
        this._row = 0;

        this.attach(this._defaultRowMaker(this._default), 0, this._row++, 1, 1);
        this._cmdsList.slice(1).forEach(x => this.attach(this._customRowMaker(x), 0, this._row++, 1, 1));
    }

    _checkJSON(str) {
        try {
            let obj = JSON.parse(str);
            let req = ['icon', 'type', 'command'];
            if(!obj.hasOwnProperty('name') || !obj.hasOwnProperty('entries') || obj.entries.some(x => req.some(y => !x.hasOwnProperty(y)))) {
                GLib.spawn_command_line_async('notify-send ' + GLib.shell_quote(Me.metadata.name) + ' ' + GLib.shell_quote(_("Missing some required properties in JSON data")));
                return false;
            }
        } catch (e) {
            GLib.spawn_command_line_async('notify-send ' + GLib.shell_quote(Me.metadata.name) + ' ' + GLib.shell_quote(e.message));
            return false;
        }
        return true;
    }

    _initStrings() {
        this.TIPS = [
            _('Add the icon to <u>~/.local/share/icons/xxxx</u>'),
            _('Use relative position when both X and Y offset are <b>0</b>'),
            _('Substitute <b>LDWORD</b> for the selection in commands'),
            _('Do <b>NOT</b> set the <i>clip</i> to <i>true</i> if the command will change clipboard'),
            _('Fake keyboard input is supported in JS statement: <u>key("Control_L+c")</u>'),
            _('Log file locates in <u>~/.cache/gnome-shell-extension-light-dict/</u>'),
        ];

        this.COMMENTS = [
            _('Required / text showing on the entry'),
            _('Optional / additional information about the entry'),
            _('Required / the icon name'),
            _('Required / Bash command or JS statement'),
            _('Required / command to run when clicking icon'),
            _('Optional / popup the panel or not'),
            _('Optional / write the clipboard or not'),
            _('Optional / paste the result (Ctrl+v) or not'),
            _('Optional / tooltip of icon when hovering'),
            _('Optional / app white list of the icon'),
            _('Optional / show the icon only when matching the RegExp'),
            _('Required / the details of the entry, which is convenient to enable or disable a group of icons in one click')
        ];

        // xgettext might be conflicted with templete string, do NOT put any translatable text after this.DEFAULTLINK
        this.DEFAULTLINK =
`{
    "name" : "link",
    "?name" : "${this.COMMENTS[0]}",
    "description" : "open URL with gio open",
    "?description" : "${this.COMMENTS[1]}",
    "entries" : [
        {
            "icon" : "link",
            "?icon" : "${this.COMMENTS[2]}",
            "type" : false,
            "?type" : "${this.COMMENTS[3]}",
            "command" : "gio open LDWORD",
            "?command" : "${this.COMMENTS[4]}",
            "popup" : false,
            "?popup" : "${this.COMMENTS[5]}",
            "clip"  : false,
            "?clip" : "${this.COMMENTS[6]}",
            "paste" : false,
            "?paste" : "${this.COMMENTS[7]}",
            "tooltip" : "open URL in default browser",
            "?tooltip" : "${this.COMMENTS[8]}",
            "windows" : ["Yelp", "Evince", "Gedit"],
            "?windows" : "${this.COMMENTS[9]}",
            "regexp" : "^(https?://)?(www\\\\.)?([-a-z0-9]{1,63}\\\\.)*?[a-z0-9][-a-z0-9]{0,61}[a-z0-9]\\\\.[a-z]{2,6}(/[-\\\\w@\\\\+\\\\.~#\\\\?&/=%]*)?$",
            "?regexp" : "${this.COMMENTS[10]}"
        }
    ],
    "?entries" : "${this.COMMENTS[11]}"
}`;
        this.TEMPLETE =
`{
    "name" : "name",
    "description" : "",
    "entries" : [
        {
            "icon" : "",
            "type" : false,
            "command" : "",
            "popup" : false,
            "clip"  : false,
            "paste" : false,
            "tooltip" : "",
            "windows" : [],
            "regexp" : ""
        }
    ]
}`;
    }

    _defaultRowMaker(cmd) {
        let hbox = new Gtk.HBox({ hexpand: true, });
        let cmdj = JSON.parse(cmd);

        hbox._text = cmd;
        hbox.row = this._row;
        this._boxes.push(hbox);

        hbox.check = new Gtk.CheckButton({ active: this._cmdsActive.includes(cmd) });
        hbox.check.connect("toggled", () => this._updateCommands(true));

        hbox.label = new Gtk.Label({
            xalign: 0,
            selectable: true,
            use_markup: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        hbox.label.set_line_wrap(false);
        hbox.label.set_markup('<b>' + cmdj.name + '</b> ' + cmdj.description);

        hbox.view = this._popSourceviewMaker('');
        hbox.view.set_image(new Gtk.Image({ icon_name: 'view-hidden' }));
        hbox.view.connect('clicked', () => {
            hbox.view.buf.text = JSON.stringify(cmdj, null, 2);
            hbox.view.pop.show_all();
        });

        hbox.add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-new', sensitive: false }) });
        hbox.add.connect("clicked", () => {
            hbox.add.set_sensitive(false);
            if(this._boxes.length > 1) return;
            this.attach(this._customRowMaker(''), 0, this._row++, 1, 1);
            this._updateCommands(false);
            this.show_all();
        });

        hbox.tips = this._popLabelViewMaker(this.TIPS);
        hbox.tips.connect("clicked", () => {
            hbox.tips.pop.show_all();
            hbox.add.set_sensitive(this._boxes.length === 1);
        });

        hbox.pack_start(hbox.check, false, false, 0);
        hbox.pack_start(hbox.view, false, false, 10);
        hbox.pack_start(hbox.label, true, true, 10);
        hbox.pack_start(hbox.add, false, false, 10);
        hbox.pack_end(hbox.tips, false, false, 0);

        return hbox;
    }

    _customRowMaker(cmd) {
        let hbox = new Gtk.HBox({ hexpand: true, });
        let cmdj = JSON.parse(cmd ? cmd : this._templete);

        hbox.row = this._row;
        this._boxes.push(hbox);
        hbox._text = cmd ? cmd : this._templete;

        hbox.label = new Gtk.Label({
            xalign : 0,
            hexpand : true,
            use_markup: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        hbox.label.set_line_wrap(false);
        hbox.label.set_markup('<b>' + cmdj.name + '</b> ' + cmdj.description);

        hbox.edit = this._popSourceviewMaker(JSON.stringify(cmdj, null, 2));
        hbox.edit.src.set_editable(cmd ? !this._cmdsActive.includes(cmd) : true);
        hbox.edit.set_image(new Gtk.Image({ icon_name: hbox.edit.src.editable ? 'entry-edit' : 'view-hidden' }));
        hbox.edit.connect('clicked', () => hbox.edit.pop.show_all());
        hbox.edit.pop.connect('closed', () => {
            if(!hbox.edit.src.editable || !this._checkJSON(hbox.edit.buf.text)) return;
            let json = JSON.parse(hbox.edit.buf.text);
            let text = JSON.stringify(json, null, 0);
            if(hbox._text === text) return;
            hbox._text = text;
            hbox.label.set_markup('<b>' + json.name + '</b> ' + json.description);
            this._updateCommands(false);
        });

        hbox.check = new Gtk.CheckButton({ active: cmd ? this._cmdsActive.includes(cmd) : false});
        hbox.check.connect("toggled", widget => {
            hbox.edit.src.set_editable(!widget.active);
            hbox.edit.set_image(new Gtk.Image({ icon_name: hbox.edit.src.editable ? 'entry-edit' : 'view-hidden' }));
            if(!this._add) this._updateCommands(true);
        });

        hbox.add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-new' }) });
        hbox.add.connect("clicked", () => {
            this.attach(this._customRowMaker(''), 0, this._row++, 1, 1);
            let idx = this._boxes.findIndex(x => x.row == hbox.row);
            this._add = true;
            for(let i = this._boxes.length - 1; i > idx + 1; i--) {
                ['.check.active', '._text', '.label.label', '.edit.buf.text'].forEach(x => {
                    eval(`let tmp = this._boxes[i]${x}; this._boxes[i]${x} = this._boxes[i-1]${x}; this._boxes[i-1]${x} = tmp;`);
                });
            }
            this._updateCommands(false);
            this._add = false;
            this.show_all();
        });

        hbox.delete = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-delete' }) });
        hbox.delete.connect("clicked", () => {
            this._boxes = this._boxes.filter(x => x.row != hbox.row);
            if(hbox.check.active) this._updateCommands(true);
            this._updateCommands(false);
            this.remove(hbox);
        });

        hbox.pack_start(hbox.check, false, false, 0);
        hbox.pack_start(hbox.edit, false, false, 10);
        hbox.pack_start(hbox.label, true, true, 10);
        hbox.pack_start(hbox.add, false, false, 10);
        hbox.pack_end(hbox.delete, false, false, 0);

        return hbox;
    }

    _popSourceviewMaker(text) {
        const btn = new Gtk.Button();
        btn.pop = new Gtk.Popover(btn);
        btn.pop.set_relative_to(btn);

        btn.buf = new GtkSource.Buffer();
        btn.buf.set_highlight_matching_brackets(true);
        btn.buf.set_language(new GtkSource.LanguageManager().get_language("json"));
        btn.buf.set_style_scheme(new GtkSource.StyleSchemeManager().get_scheme("oblivion"));
        btn.buf.text = text;

        btn.src = GtkSource.View.new_with_buffer(btn.buf);
        btn.src.set_auto_indent(true);
        btn.src.set_highlight_current_line(true);
        btn.src.set_indent_on_tab(true);
        btn.src.set_indent_width(2);
        btn.src.set_insert_spaces_instead_of_tabs(true);
        btn.src.set_right_margin_position(10);
        btn.src.set_show_line_numbers(true);
        btn.src.set_show_right_margin(true);
        btn.src.set_tab_width(2);
        btn.src.modify_font(Pango.font_description_from_string("Hack 16"));

        let frame = new Gtk.Frame();
        let scroll = new Gtk.ScrolledWindow({ min_content_height: 400, min_content_width: 700 });
        scroll.add(btn.src);
        frame.add(scroll);
        btn.pop.add(frame);

        return btn;
    }

    _popLabelViewMaker(msgs) {
        const tips = new Gtk.Button({ image: new Gtk.Image({ icon_name: "help-about" }) });
        tips.pop = new Gtk.Popover(tips);
        tips.pop.set_relative_to(tips);

        const vbox = new Gtk.VBox();
        msgs.map((msg, i) => {
            const label = new Gtk.Label();
            label.set_markup((i + 1) + '. ' + msg);
            label.set_alignment(0, 0.5);
            label.set_line_wrap(true);
            label.set_margin_top(5);
            label.set_max_width_chars(60);
            return label;
        }).forEach(l => vbox.add(l));
        tips.pop.add(vbox);

        return tips;
    }

    _updateCommands(type) {
        if(type) {
            gsettings.set_strv(Fields.ACOMMANDS, Array.from(this._boxes.filter(x => x.check.active), y => y._text));
        } else {
            gsettings.set_strv(Fields.ICOMMANDS, Array.from(this._boxes, x => x._text));
        }
    }
});
