// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class CandidateRow {
    constructor(keyboard, previousLabel, nextLabel) {
        this._keyboard = keyboard;
        this._nativeRow = keyboard._suggestions;
        this._row = new St.BoxLayout({
            style_class: 'word-suggestions',
            style: 'min-height: auto; padding-top: 0; padding-bottom: 0;',
            visible: false,
        });
        this._previous = new St.Button({label: '‹', accessible_name: previousLabel});
        this._next = new St.Button({label: '›', accessible_name: nextLabel});
        this._candidates = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
        });
        const center = new St.Bin({x_expand: true, child: this._candidates});

        this._row.add_child(this._previous);
        this._row.add_child(center);
        this._row.add_child(this._next);
        keyboard.insert_child_above(this._row, this._nativeRow);

        this._previous.connect('clicked', () => this._turn(-1));
        this._next.connect('clicked', () => this._turn(1));
        this._widthId = keyboard.connect('notify::width', () => this._reflow());
        this._row.connect('style-changed', () => this._reflow());
        this._nativeChildId = this._nativeRow.connect('child-removed', () => {
            if (this._page)
                this._hideEmptyNativeRow();
        });
    }

    show(page) {
        // Going back across an engine-page boundary enters that page from its end.
        const anchor = this._waiting && this._enterAtEnd ? page.table.length - 1 : 0;
        this._page = null;
        this._candidates.destroy_all_children();
        this._buttons = page.table.map((text, index) => {
            const button = new St.Button({label: text.split('\n', 1)[0]});
            button.connect('clicked', () => {
                if (button.visible && !this._waiting)
                    page.select(index);
            });
            this._candidates.add_child(button);
            return button;
        });

        this._hideEmptyNativeRow();
        this._row.show();
        this._page = page;
        this._waiting = false;
        this._enterAtEnd = false;
        this._reflow(anchor);
    }

    setFontScale(percent) {
        this._candidates.style = percent === 100 ? null : `font-size: ${percent}%;`;
        this._reflow();
    }

    _reflow(anchor = this._starts?.[this._localPage] ?? 0) {
        if (!this._page || this._reflowing)
            return;

        this._reflowing = true;
        try {
            const theme = this._row.get_theme_node();
            const width = theme.adjust_for_width(this._keyboard.width);
            const widths = this._buttons.map(button => {
                // St defers style updates for buttons on hidden local pages.
                button.ensure_style();
                return button.get_preferred_width(-1)[1];
            });
            const total = widths.reduce((sum, value) => sum + value, 0);
            const needsArrows = this._page.previous || this._page.next ||
                widths.length > 1 && total > width;
            const arrowSpace = needsArrows
                ? this._previous.get_preferred_width(-1)[1] +
                    this._next.get_preferred_width(-1)[1] + 2 * theme.get_length('spacing')
                : 0;

            const available = width - arrowSpace;
            this._starts = [0];
            let used = 0;
            widths.forEach((candidateWidth, index) => {
                if (index > this._starts.at(-1) && used + candidateWidth > available) {
                    this._starts.push(index);
                    used = 0;
                }
                used += candidateWidth;
            });
            this._localPage = this._starts.findLastIndex(start => start <= anchor);
            this._render();
        } finally {
            this._reflowing = false;
        }
    }

    _turn(offset) {
        if (!this._page || this._waiting)
            return;

        const localPage = this._localPage + offset;
        if (localPage >= 0 && localPage < this._starts.length) {
            this._localPage = localPage;
            this._render();
            return;
        }

        const action = offset < 0 ? this._page.previous : this._page.next;
        if (action) {
            this._enterAtEnd = offset < 0;
            action();
        }
    }

    _render() {
        const start = this._starts[this._localPage];
        const end = this._starts[this._localPage + 1] ?? this._buttons.length;
        const canGoBack = this._localPage > 0 || !!this._page.previous;
        const canGoForward = end < this._buttons.length || !!this._page.next;
        this._previous.visible = this._next.visible = canGoBack || canGoForward;
        this._previous.reactive = !this._waiting && canGoBack;
        this._next.reactive = !this._waiting && canGoForward;
        this._previous.opacity = this._previous.reactive ? 255 : 102;
        this._next.opacity = this._next.reactive ? 255 : 102;
        this._buttons.forEach((button, index) => {
            button.visible = index >= start && index < end;
            button.reactive = button.visible && !this._waiting;
        });
    }

    setWaiting(waiting) {
        this._waiting = waiting;
        if (!waiting)
            this._enterAtEnd = false;
        this._render();
    }

    _hideEmptyNativeRow() {
        // The Shell theme gives even an empty suggestions row a minimum height.
        if (this._nativeRow.visible && !this._nativeRow.get_n_children()) {
            this._nativeRow.hide();
            this._nativeRowHidden = true;
        }
    }

    hide() {
        if (!this._page)
            return;
        this._page = null;
        this._waiting = false;
        this._enterAtEnd = false;
        this._row.hide();
        this._candidates.destroy_all_children();
        this._buttons = [];
        if (this._nativeRowHidden) {
            this._nativeRow.show();
            this._nativeRowHidden = false;
        }
    }

    destroy() {
        this.hide();
        this._keyboard.disconnect(this._widthId);
        this._nativeRow.disconnect(this._nativeChildId);
        this._row.destroy();
    }
}
