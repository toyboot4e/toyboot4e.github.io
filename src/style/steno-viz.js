// 3x11 keyboard image
class StenoViz extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: flex;
        width: 100%;
        flex-direction: column;
        align-items: center;
        gap: 20px;
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
      Array(chars[1].length).fill(false),
      Array(chars[2].length).fill(false),
    ];

    if (stroke === undefined || stroke === null || stroke === '') {
      return ret;
    }

    // steno order: #STKPWHRAO*EUFRPBLGTSDZ
    const stenoOrder = [
      // #0    1       2       3       4       5       6       7
      [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3],
      // 8
      [0, 4],
      // #9    10      11      12      13      #14
      [2, 2], [2, 3], [2, 4], [2, 6], [2, 7], [2, 8],
      // *15
      [0, 7], [1, 7], [0, 8], [1, 8], [0, 9], [1, 9], [0, 10], [1, 10], [0, 11], [1, 11],
    ];

    const iAster = 15

    let iOrder = 0
    for (let c of stroke) {
      if (iOrder >= stenoOrder.length) break;
      if (c == '-') {
          if (iOrder < iAster) iOrder = iAster;
          continue;
      }
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

    // '#'
      ret[2][2] = ret[0][0];
      ret[2][8] = ret[0][0];

    return ret;
  }

  connectedCallback() {
    const chars = [
      ['#', 'T', 'P', 'H', '*', '', '*', 'F', 'P', 'L', 'T', 'D'],
      ['S', 'K', 'W', 'R', '', '', '', 'R', 'B', 'G', 'S', 'Z'],
      ['', '',  '#', 'A', 'O', '', 'E', 'U', '#', '', '', ''],
    ];

    const strokes = this.textContent.toUpperCase().split('/');
    for (let stroke of strokes) {
      this.shadowRoot.appendChild(this.renderStroke(chars, stroke));
    }
  }

  renderStroke(chars, stroke) {
    const container = document.createElement('div');
    container.className = 'steno-viz-container';
    const isPressed = StenoViz.collectKeyPress(chars, stroke);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < chars[row].length; col++) {
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
    return container;
  }
}

customElements.define('steno-outline', StenoViz);
