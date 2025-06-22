// 3x11 keyboard image
class StenoViz extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        text-align: center;
      }
      .steno-viz-container {
        display: inline-grid;
        grid-template-rows: repeat(3, 32px);
        grid-template-columns: repeat(10, 32px);
        gap: 4px;
        position: relative;
      }
      .steno-viz-rect, .steno-viz-empty {
        width: 32px;
        height: 32px;
        box-sizing: border-box;
      }
      .steno-viz-rect {
        text-align: center;
        border: 1px solid white;
        border-radius: 3px;
      }
      .steno-viz-rect-pressed {
        background: #4a90e2;
      }
      .steno-viz-fat {
        width: 32px;
        height: 66px; /* 32 + 4 + 32 */
        display: flex;
        flex-direction: column;
        justify-content: stretch;
        align-items: stretch;
      }
    `;

    shadow.appendChild(style);
  }

  static collectKeyPress(chars, stroke) {
    const ret = [
      Array(chars[0].length).fill(false),
      Array(chars[0].length).fill(false),
      Array(chars[0].length).fill(false),
    ];

    if (stroke === undefined || stroke === null || stroke === '') {
      return ret;
    }

    // steno order: #STKPWHRAO*EUFRPBLGTSDZ
    const stenoOrder = [
      [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3],
      [0, 4],
      [2, 3], [2, 4], [2, 6], [2, 7],
      [0, 7], [1, 7], [0, 8], [1, 8], [0, 9], [1, 9], [0, 10], [1, 10], [0, 11], [1, 11],
    ];

    let iOrder = 0
    for (let c of stroke) {
      if (iOrder >= stenoOrder.length) break;
      while (iOrder < stenoOrder.length) {
        const [row, col] = stenoOrder[iOrder++];
        if (c == chars[row][col]) {
          ret[row][col] = true;
          break;
        }
      }
    }

    // '*'
    ret[0][6] = ret[0][4];
    return ret;
  }

  connectedCallback() {
    const container = document.createElement('div');
    container.className = 'steno-viz-container';

    const leftCol = 4;
    const chars = [
      ['#', 'T', 'R', 'H', '*', '', '*', 'F', 'P', 'L', 'T', 'D'],
      ['S', 'K', 'W', 'R', '', '', '', 'R', 'B', 'G', 'S', 'Z'],
      ['', '',  '#', 'A', 'O', '', 'E', 'U', '#', '', '', ''],
    ];
    const isPressed = StenoViz.collectKeyPress(chars, this.textContent.toUpperCase());

    // render
    const columnDef = [2, 2, 2, 3, -1, -1, 3, 3, 2, 2, 2, 2]
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < columnDef.length; col++) {
        const def = columnDef[col];
        const isLeft = col <= 4;
        const c = chars[row][col];

        let ty = 'steno-viz-empty';
        if (c == '*') ty = 'steno-viz-rect steno-viz-fat'
        if (c != '' && c != '*') ty = 'steno-viz-rect';
        if (isPressed[row][col]) ty += ' steno-viz-rect-pressed';

        const rect = document.createElement('div');
        rect.className = ty;
        rect.textContent = chars[row][col];
        rect.style.gridRow = row + 1;
        rect.style.gridColumn = col + 1;
        container.appendChild(rect);
      }
    }

    this.shadowRoot.appendChild(container);
  }
}

customElements.define('steno-outline', StenoViz);
