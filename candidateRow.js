// SPDX-License-Identifier: GPL-3.0-or-later

import Pango from 'gi://Pango';
import St from 'gi://St';

export class CandidateRow {
    constructor(keyboard, previousLabel, nextLabel) {
        this._row = new St.BoxLayout({
            style_class: 'word-suggestions',
            visible: false,
        });
        this._previous = new St.Button({label: '‹', accessible_name: previousLabel});
        this._next = new St.Button({label: '›', accessible_name: nextLabel});
        this._scroll = new St.ScrollView({
            x_expand: true,
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
        });
        this._candidates = new St.BoxLayout();
        this._scroll.set_child(this._candidates);

        this._row.add_child(this._previous);
        this._row.add_child(this._scroll);
        this._row.add_child(this._next);
        keyboard.insert_child_above(this._row, keyboard._suggestions);

        this._previous.connect('clicked', () => this._page?.previous?.());
        this._next.connect('clicked', () => this._page?.next?.());
    }

    show(page) {
        this._page = page;
        this._candidates.destroy_all_children();
        page.table.forEach((text, index) => {
            const button = new St.Button({label: text.split('\n', 1)[0]});
            // Keep the full label width so the scroll view can handle overflow.
            const label = button.get_child();
            if (label)
                label.ellipsize = Pango.EllipsizeMode.NONE;
            button.connect('clicked', () => page.select(index));
            this._candidates.add_child(button);
        });

        this._scroll.hadjustment.value = 0;
        const pageable = !!(page.previous || page.next);
        this._previous.visible = pageable;
        this._next.visible = pageable;
        this.setWaiting(false);
        this._row.show();
    }

    setWaiting(waiting) {
        this._previous.reactive = !waiting && !!this._page.previous;
        this._next.reactive = !waiting && !!this._page.next;
        this._previous.opacity = this._previous.reactive ? 255 : 102;
        this._next.opacity = this._next.reactive ? 255 : 102;
        for (const button of this._candidates.get_children())
            button.reactive = !waiting;
    }

    hide() {
        if (!this._page)
            return;
        this._page = null;
        this._row.hide();
        this._candidates.destroy_all_children();
    }

    destroy() {
        this._row.destroy();
    }
}
