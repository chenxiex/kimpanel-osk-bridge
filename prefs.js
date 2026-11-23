// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KimpanelOskBridgePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        const fontSize = new Adw.SpinRow({
            title: this.gettext('Candidate font size (%)'),
            subtitle: this.gettext('100% uses the GNOME theme size.'),
            adjustment: new Gtk.Adjustment({lower: 75, upper: 150, step_increment: 5}),
            numeric: true,
        });
        settings.bind('candidate-font-scale', fontSize, 'value', Gio.SettingsBindFlags.DEFAULT);

        group.add(fontSize);
        page.add(group);
        window.add(page);
    }
}
