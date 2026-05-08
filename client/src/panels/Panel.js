// Base Panel — shared DOM scaffolding, drag-by-header, show/hide.

export class Panel {
  constructor(layer, title, position) {
    this.layer = layer;
    this.el = document.createElement('div');
    this.el.className = 'panel hidden';
    if (typeof position.x === 'string' && position.x.startsWith('right:')) {
      this.el.style.right = position.x.split(':')[1] + 'px';
    } else {
      this.el.style.left = position.x + 'px';
    }
    this.el.style.top = position.y + 'px';

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<div class="panel-title">${title}</div><button class="panel-close" title="Close">×</button>`;
    this.body = document.createElement('div');
    this.body.className = 'panel-body';
    this.el.appendChild(header);
    this.el.appendChild(this.body);
    this.layer.appendChild(this.el);

    header.querySelector('.panel-close').addEventListener('click', () => this.hide());

    // Drag
    let dragStart = null;
    const onDown = (e) => {
      if (e.target.classList.contains('panel-close')) return;
      const rect = this.el.getBoundingClientRect();
      dragStart = {
        sx: e.clientX, sy: e.clientY,
        rectLeft: rect.left, rectTop: rect.top
      };
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragStart) return;
      const nx = dragStart.rectLeft + (e.clientX - dragStart.sx);
      const ny = dragStart.rectTop + (e.clientY - dragStart.sy);
      this.el.style.right = '';
      this.el.style.left = `${nx}px`;
      this.el.style.top = `${ny}px`;
    };
    const onUp = () => { dragStart = null; };
    header.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }
  isVisible() { return !this.el.classList.contains('hidden'); }
}
