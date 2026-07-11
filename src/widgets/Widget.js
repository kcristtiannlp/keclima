/**
 * Classe base para todos os widgets.
 * @module widgets/Widget
 */

import { el } from '../utils/dom.js';

export class Widget {
  /**
   * @param {Object} options
   * @param {string} options.id
   * @param {string} options.title
   * @param {string} [options.icon]
   * @param {string} [options.className]
   */
  constructor({ id, title, icon = '', className = '' }) {
    this.id = id;
    this.title = title;
    this.icon = icon;
    this.className = className;
    /** @type {HTMLElement|null} */
    this.root = null;
    /** @type {HTMLElement|null} */
    this.body = null;
  }

  /**
   * Monta o shell do widget.
   * @returns {HTMLElement}
   */
  mount() {
    this.root = el('article', {
      className: `widget ${this.className}`.trim(),
      id: `widget-${this.id}`,
      dataset: { widget: this.id },
    });

    const header = el('header', { className: 'widget-header' }, [
      this.icon ? el('span', { className: 'widget-icon', text: this.icon }) : null,
      el('h3', { className: 'widget-title', text: this.title }),
    ]);

    this.body = el('div', { className: 'widget-body' });
    this.root.append(header, this.body);
    this.render();
    return this.root;
  }

  /**
   * Atualiza título (ex.: após troca de idioma).
   * @param {string} title
   */
  setTitle(title) {
    this.title = title;
    const titleEl = this.root?.querySelector('.widget-title');
    if (titleEl) {
      titleEl.textContent = title;
    }
  }

  /**
   * Renderiza o conteúdo. Subclasses sobrescrevem.
   */
  render() {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
  }

  /**
   * Atualiza dados e re-renderiza.
   * @param {any} _data
   */
  update(_data) {
    this.render();
  }

  /**
   * Remove o widget do DOM.
   */
  destroy() {
    this.root?.remove();
    this.root = null;
    this.body = null;
  }
}
