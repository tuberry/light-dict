// vim:fdm=syntax
// by: tuberry@github
const { GLib, Gtk, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

'use strict';

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
    ICONPAGESIZE: 'icon-pagesize',
    TEXTSTRIP:    'enable-strip',
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
            window.resize(730,600);
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
        this._field_sensitive_mode = new Gtk.Switch();
        this._field_command_editable = new Gtk.Switch();
        this._field_hide_panel_title = new Gtk.Switch();
        this._field_enable_strip = new Gtk.Switch();
        this._field_black_or_white = new Gtk.Switch();

        this._field_auto_hide = this._spinMaker(500, 10000, 250);
        this._field_log_level = this._comboMaker(_('Never/Click/Hover/Always'));
        this._field_trigger_style = this._comboMaker(_('Icon/Keyboard/Auto'));

        this._field_enable_keybinding = new Gtk.Switch();
        this._field_keybinding = this._shortCutMaker(Fields.SHORTCUTNAME);
        this._field_enable_keybinding.connect("notify::active", widget => {
            this._field_keybinding.set_sensitive(widget.active);
        });


        this._field_apps_list = this._entryMaker('Yelp#Evince', _('Application white/black list(asterisk for all)'));
        this._field_filter = this._entryMaker('^[^\\n\\.\\t\\/:]{3,50}$', _('Text RegExp filter for auto mode'));
        this._field_click_command = this._entryMaker('notify-send hello', _('Command to run when clicking panel'));
        this._field_open_url = this._entryMaker('https://www.bing.com/dict/search=?q=LDWORD', _('Search in default browser'));
        this._field_dict_command = this._entryMaker("dict -- LDWORD | sed -e 1,6d # trans -no-ansi :zh-cn -- LDWORD", _('Command to run in auto mode'));

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
        this._addRow(this._field_auto_hide,         this._labelMaker(_("Autohide interval (ms)")));
        this._addRow(this._field_hide_panel_title,  this._labelMaker(_("Hide panel title")));
        this._addRow(this._field_sensitive_mode,    this._labelMaker(_("Panel seamless mode")));
        this._addRow(this._field_black_or_white,    this._labelMaker(_("Blacklist or whitelist")));
        this._addRow(this._field_enable_strip,      this._labelMaker(_("Remove extra whitespaces")));
        this._addRow(hseparator(),                  null);
        this._addRow(this._field_enable_keybinding, this._labelMaker(_("Shortcuts to trigger")));
        this._addRow(this._field_keybinding,        this._labelMaker(_("show popup panel")));
        this._addRow(hseparator(),                  null);
        this._addRow(this._field_command_editable,  this._labelMaker(_("Edit commands below")));
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
        gsettings.bind(Fields.SENSITIVE,  this._field_sensitive_mode,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOGSLEVEL,  this._field_log_level,         'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,    this._field_trigger_style,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SHORTCUT,   this._field_enable_keybinding, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE,  this._field_hide_panel_title,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.EDITABLE,   this._field_command_editable,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP,  this._field_enable_strip,      'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.BLACKWHITE, this._field_black_or_white,    'active', Gio.SettingsBindFlags.DEFAULT);
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
        ops.split('/').map(name => ({name})).forEach((p,i) => l.set(l.append(),[0],[p.name]));
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
        this._cmdsList = gsettings.get_strv(Fields.ICOMMANDS);
        this._cmdsActive = gsettings.get_strv(Fields.ACOMMANDS);
        this._default = ["link#000#gio open LDWORD"]

        this._boxes = [];
        this._action = false;
        this._row = 0;

        this.attach(this._headerRow(), 0, this._row++, 1, 1);
        this._default.forEach(x => {
            this.attach(this._rowMaker(x, true), 0, this._row++, 1, 1);
        });

        this._cmdsList.slice(this._default.length).forEach( a => {
            let box = this._rowMaker(a, false);
            box.row = this._row;
            this._boxes.push(box);
            this.attach(box, 0, this._row++, 1, 1);
        });
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

    _headerRow() {
        const hbox = new Gtk.HBox({
            hexpand: true,
        });

        const xoff = new Gtk.Label({label: _('X offset')});
        const xfsp = this._spinMaker(-400,400,5);
        const yoff = new Gtk.Label({label: _('Y offset')});
        const yfsp = this._spinMaker(-400,400,5);
        const page = new Gtk.Label({label: _('Page size')});
        const pgsp = this._spinMaker(0, 10, 1);
        const vseparator = (x,y) => new Gtk.VSeparator({margin_left: x, margin_right: y});

        const toggle = new Gtk.Button({ label: _('!') });
        toggle.connect('clicked', () => {
            this._action = !this._action;
            if(!this._boxes.length) {
                let box = this._rowMaker('', false);
                this._boxes.push(box);
                this.attach(box, 0, this._row++, 1, 1);
                this.show_all();
            }
            this._boxes.forEach(x => x.toggle.set_label(this._action ? _('+') : _('×')));
        });
        gsettings.bind(Fields.XOFFSET, xfsp, 'value', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.YOFFSET, yfsp, 'value', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ICONPAGESIZE, pgsp, 'value', Gio.SettingsBindFlags.DEFAULT);

        hbox.pack_start(page, true, true, 5);
        hbox.pack_start(pgsp, true, true, 5);
        hbox.pack_start(vseparator(0,0), false, false, 0);
        hbox.pack_start(xoff, true, true, 5);
        hbox.pack_start(xfsp, true, true, 5);
        hbox.pack_start(vseparator(0,0), false, false, 0);
        hbox.pack_start(yoff, true, true, 5);
        hbox.pack_start(yfsp, true, true, 5);
        hbox.pack_start(vseparator(0,0), false, false, 0);
        hbox.pack_end(toggle, false, false, 0);
        return hbox;
    }

    _tips(_) {
        return [
            _('Show all icons if <i>page size</i> is <b>0</b>, and use relative position when <i>offset</i> is <b>0</b>'),
            _('Add the icon (svg format is recommended) to <u>~/.local/share/icons/xxxx</u> if <big>?</big> appears to icon bar'),
            _('Press <big>+</big> to add a command entry, <big>×</big> to remove, <big>☐</big> to enable and <big>!</big> to toggle, separate different commands with <big>##</big>'),
            _('The control word <i>rwx</i> means <u>show popup panel or not</u>, <u>write clipboard or not</u> and <u>run with eval or bash</u>'),
            _('Substitude <b>LDWORD</b> for the selection, note that all the bash commands run in <u>$HOME</u> by default, be cautious of any <u>file operation</u>'),
            _('If you wanna paste the result to the selection, you should add <u>@paste</u> at beginning of a commamd'),
            _('Do <b>NOT</b> set the <i>w</i> to 1 if the command will change the clipboard, otherwise uncertain behavior may occur to the icon bar'),
        ]
    }

    _rowMaker(cmd, def) {
        let hbox = new Gtk.HBox({ hexpand: true, });

        if(def) {
            let check = new Gtk.CheckButton({ });
            check.active = this._cmdsActive.indexOf(cmd) > -1;
            check.connect("toggled", this._cmdsUpdate.bind(this));

            let label = new Gtk.Label({xalign: 0});
            label.selectable = true;
            label.set_text(cmd);

            const tips = this._popButtonMaker(_('?'), this._tips(_));

            hbox.pack_start(check, false, false, 0);
            hbox.pack_start(label, false, false, 10);
            hbox.pack_end(tips, false, false, 0);
        } else {
            hbox.entry = new Gtk.Entry({
                placeholder_text: 'icon#rwx#@paste what you want',
            });
            hbox.entry.set_text(cmd);
            hbox.entry.set_sensitive(this._cmdsActive.indexOf(cmd) === -1)
            hbox.entry.connect('changed', this._cmdsUpdate.bind(this));

            hbox.check = new Gtk.CheckButton({ });
            hbox.check.active = this._cmdsActive.indexOf(cmd) > -1;
            hbox.check.connect("toggled", (widget) => {
                hbox.entry.set_sensitive(!widget.active);
                this._cmdsUpdate();
            });

            hbox.toggle = new Gtk.Button();
            hbox.toggle.set_label(this._action ? _("+") : _("×"));
            hbox.toggle.hbox = hbox;
            hbox.toggle.connect("clicked", (widget) => {
                if(!this._action) {
                    this.remove(widget.hbox);
                    this._boxes = this._boxes.filter(x => x.row != widget.hbox.row);
                    this._cmdsUpdate();
                } else {
                    let box = this._rowMaker('', false);
                    this._boxes.push(box);
                    this.attach(box, 0, this._row++, 1, 1);
                    let idx = this._boxes.findIndex(x => x.row == widget.hbox.row);
                    for (var i = this._boxes.length - 1; i > idx + 1; i--) {
                        let active = this._boxes[i].check.active;
                        this._boxes[i].check.active = this._boxes[i-1].check.active;
                        this._boxes[i-1].check.active = active;

                        let text = this._boxes[i].entry.get_text();
                        this._boxes[i].entry.set_text(this._boxes[i-1].entry.get_text());
                        this._boxes[i-1].entry.set_text(text);
                    }
                    this.show_all();
                }
            });

            hbox.pack_start(hbox.check, false, false, 0);
            hbox.pack_start(hbox.entry, true, true, 10);
            hbox.pack_end(hbox.toggle, false, false, 0);
        }

        return hbox;
    }

    _popButtonMaker(lb, msgs) {
        const tips = new Gtk.Button({ label: lb});
        const pop = new Gtk.Popover(tips);

        pop.set_relative_to(tips);
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
        pop.add(vbox);
        tips.connect('clicked', () => {
            pop.show_all();
        });

        return tips;
    }

    _cmdsUpdate() {
        let cmdsList = [];
        let cmdsActive = [];
        this.get_children().slice(0, -1).forEach(row => {
            let [check, entry] = row.get_children();
            cmdsList.push(entry.get_text());
            if (check.active)
                cmdsActive.push(entry.get_text());
        });

        if(this._cmdsList.toString() !== cmdsList.toString()) {
            gsettings.set_strv(Fields.ICOMMANDS, cmdsList.reverse());
            this._cmdsList = cmdsList.reverse();
        }

        if(this._cmdsActive.toString() !== cmdsActive.toString()) {
            gsettings.set_strv(Fields.ACOMMANDS, cmdsActive.reverse());
            this._cmdsActive = cmdsActive.reverse();
        }
    }
});
